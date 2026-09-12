// FlashcardsList v0.62.11 — sistema de autoevaluación.
//
// 4 vistas (tabs arriba):
//   1. Hoy: tarjetas vencidas (FSRS due) + nuevas (nextReview == null)
//   2. Conceptos: términos extraídos de notas que aún no son flashcards
//                 (tap → crear flashcard). Es el sistema de autoevaluación
//                 de conceptos anteriores del usuario.
//   3. Aprobar: Drafts (cards generadas automáticamente por auto_flashcard
//                service, pendientes de revisión humana).
//   4. Todas: lista completa con búsqueda.
//
// Cada card muestra: cloze question con ______ en negrita, badge dificultad
// FSRS (1-5), stability bar, próxima review, indicador due/new/draft.

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import '../../core/design_tokens.dart';
import '../../core/theme.dart';
import '../../services/flashcard_service.dart';
import '../../services/logger.dart';
import '../../services/vault_detector.dart';
import '../../services/vault_service.dart';
import '../../utils/safe_call.dart';
import '../../widgets/empty_state.dart';
import 'flashcard_review.dart';
import 'flashcard_edit.dart';

class FlashcardsList extends StatefulWidget {
  const FlashcardsList({super.key});
  @override
  State<FlashcardsList> createState() => _FlashcardsListState();
}

class _FlashcardsListState extends State<FlashcardsList>
    with SingleTickerProviderStateMixin {
  FlashcardService? _service;
  VaultService? _vault;
  List<Flashcard> _all = [];
  List<Flashcard> _filtered = [];
  bool _loading = true;
  String _search = '';
  late TabController _tab;

  // Conceptos: lista de términos extraídos de notas que NO son aún flashcards.
  List<_ConceptCandidate> _conceptCandidates = [];

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 4, vsync: this);
    _tab.addListener(() {
      if (!_tab.indexIsChanging) {
        setState(() {}); // re-render al cambiar tab
      }
    });
    _load();
  }

  @override
  void dispose() {
    _tab.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; });
    final log = AdvancedLogger.instance;
    try {
      final detector = VaultDetector();
      final vaults = await detector.detectVaults();
      if (!mounted) return;
      if (vaults.isEmpty) {
        setState(() { _loading = false; });
        return;
      }
      _service = FlashcardService(vaults.first.path);
      _vault = VaultService(vaults.first.path);
      _all = await _service!.listAll();
      _conceptCandidates = await _extractConceptCandidates();
      if (!mounted) return;
      _applyFilter();
      log.debug('flashcards_list', 'loaded', context: {
        'count': _all.length,
        'concepts': _conceptCandidates.length,
      });
    } catch (e, s) {
      log.error('flashcards_list', '[EC-UI-003] Load flashcards failed', error: e, stack: s);
    }
    if (!mounted) return;
    setState(() { _loading = false; });
  }

  void _applyFilter() {
    if (_search.isEmpty) {
      _filtered = List.of(_all);
    } else {
      final q = _search.toLowerCase();
      _filtered = _all.where((c) =>
        c.question.toLowerCase().contains(q) ||
        c.answer.toLowerCase().contains(q)).toList();
    }
  }

  /// Extrae candidatos a concepto desde las notas del vault:
  /// - Líneas con **término**: (markdown bold)
  /// - Wikilinks [[término]] ya resueltos
  /// - Frontmatter tags #
  /// - Subtítulos H1/H2 que no estén ya como flashcards
  Future<List<_ConceptCandidate>> _extractConceptCandidates() async {
    if (_vault == null) return [];
    try {
      final tree = await _vault!.loadTree();
      final allNotes = <String>[];
      void walk(VaultNode n) {
        if (n.isDir) {
          for (final c in n.children) walk(c);
        } else if (n.relPath.endsWith('.md')) {
          allNotes.add(p.join(_vault!.vaultPath, n.relPath));
        }
      }
      walk(tree);

      final existingQuestions = _all
          .map((c) => c.question.toLowerCase().trim())
          .toSet();
      final candidates = <String, _ConceptCandidate>{};

      for (final notePath in allNotes) {
        // v0.62.11: excluir notas internas
        if (notePath.contains('/_M-NEXUS/')) continue;
        String content;
        try {
          content = await File(notePath).readAsString();
        } catch (_) {
          continue;
        }
        // Quitar frontmatter
        var body = content;
        if (body.startsWith('---')) {
          final end = body.indexOf('---', 3);
          if (end > 0) body = body.substring(end + 3);
        }

        // 1) **Término:** explicaciones
        final boldRe = RegExp(r'\*\*([^*\n]{3,60})\*\*');
        for (final m in boldRe.allMatches(body)) {
          final term = m.group(1)!.trim();
          if (_isLikelyConcept(term) && !existingQuestions.contains(term.toLowerCase())) {
            candidates[term] ??= _ConceptCandidate(
              term: term,
              sourcePath: notePath,
              count: 0,
            );
            candidates[term]!.count++;
          }
        }

        // 2) Subtítulos ## Término
        final h2Re = RegExp(r'^#{2,3}\s+(.+)$', multiLine: true);
        for (final m in h2Re.allMatches(body)) {
          final term = m.group(1)!.trim();
          if (_isLikelyConcept(term) && !existingQuestions.contains(term.toLowerCase())) {
            candidates[term] ??= _ConceptCandidate(
              term: term,
              sourcePath: notePath,
              count: 0,
            );
            candidates[term]!.count++;
          }
        }
      }

      final list = candidates.values.toList()
        ..sort((a, b) => b.count.compareTo(a.count));
      return list.take(40).toList();
    } catch (_) {
      return [];
    }
  }

  bool _isLikelyConcept(String s) {
    if (s.length < 3 || s.length > 80) return false;
    // Filtrar frases verbales
    if (s.contains('\n')) return false;
    // Filtrar palabras funcionales al inicio
    const badStarts = ['el ', 'la ', 'los ', 'las ', 'un ', 'una ', 'de ', 'a ', 'y ', 'o '];
    final lower = s.toLowerCase();
    if (badStarts.any(lower.startsWith)) return false;
    return true;
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(message: 'Cargando tarjetas…');
    if (_service == null) {
      return const EmptyState(icon: Icons.folder_off, title: 'Sin vault');
    }

    final dueCount = _all.where((c) => c.isDue).length;
    final newCount = _all.where((c) => c.nextReview == null && c.approved).length;
    final draftCount = _all.where((c) => !c.approved).length;

    return Scaffold(
      // v0.62.11: SafeArea(top:true) — esta pantalla no usa AppBar, solo
      // un header custom. Sin SafeArea, el contenido se mete detrás del
      // status bar (vimos "Tarjetas" superpuesto con la hora 14:54).
      body: SafeArea(
        top: true,
        bottom: false,
        child: Column(
        children: [
          // Header con tabs (Notion-style segmented)
          _buildHeader(context, dueCount, newCount, draftCount),
          // Search bar (visible solo en "Todas")
          if (_tab.index == 3) _buildSearch(),
          const Divider(height: 1),
          Expanded(child: _buildBody()),
        ],
      ),
      ),
      floatingActionButton: _buildFab(),
    );
  }

  Widget _buildHeader(BuildContext context, int due, int fresh, int drafts) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Container(
      padding: const EdgeInsets.fromLTRB(MxSpacing.lg, MxSpacing.md, MxSpacing.lg, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 36, height: 36,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFFA78BFA), Color(0xFF8B5CF6)],
                  ),
                  borderRadius: BorderRadius.circular(MxRadius.sm),
                ),
                alignment: Alignment.center,
                child: const Icon(Icons.style_rounded, size: 20, color: Colors.white),
              ),
              const SizedBox(width: MxSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Tarjetas',
                      style: theme.textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.4,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              if (due > 0)
                FilledButton.icon(
                  onPressed: () => _startReview(_all.where((c) => c.isDue).toList()),
                  icon: const Icon(Icons.play_arrow_rounded, size: 18),
                  label: const Text('Repasar'),
                  style: FilledButton.styleFrom(
                    backgroundColor: MxColors.indigoDeep,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: MxSpacing.md),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.only(left: 46),
            child: Text(
              '${_all.length} total · $due para repasar · $drafts por aprobar',
              style: theme.textTheme.bodySmall?.copyWith(
                color: scheme.onSurfaceVariant,
                fontSize: 11,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(height: MxSpacing.md),
          // Tab bar custom (segmented)
          Container(
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest.withOpacity(0.5),
              borderRadius: BorderRadius.circular(MxRadius.md),
              border: Border.all(color: scheme.outlineVariant.withOpacity(0.3)),
            ),
            padding: const EdgeInsets.all(3),
            child: TabBar(
              controller: _tab,
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              indicator: BoxDecoration(
                color: scheme.surface,
                borderRadius: BorderRadius.circular(MxRadius.sm),
                boxShadow: MxShadows.sm,
              ),
              indicatorSize: TabBarIndicatorSize.tab,
              dividerColor: Colors.transparent,
              labelColor: MxColors.indigoDeep,
              unselectedLabelColor: scheme.onSurfaceVariant,
              labelStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12),
              unselectedLabelStyle: const TextStyle(fontWeight: FontWeight.w500, fontSize: 12),
              tabs: [
                Tab(text: 'Hoy ($due)'),
                Tab(text: 'Conceptos (${_conceptCandidates.length})'),
                Tab(text: 'Aprobar ($drafts)'),
                const Tab(text: 'Todas'),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSearch() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(MxSpacing.lg, MxSpacing.md, MxSpacing.lg, MxSpacing.sm),
      child: TextField(
        decoration: InputDecoration(
          hintText: 'Buscar en preguntas y respuestas…',
          prefixIcon: const Icon(Icons.search_rounded, size: 18),
          suffixIcon: _search.isNotEmpty
              ? IconButton(
                  icon: const Icon(Icons.clear_rounded, size: 18),
                  onPressed: () {
                    setState(() {
                      _search = '';
                      _applyFilter();
                    });
                  },
                )
              : null,
          isDense: true,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(MxRadius.md),
          ),
        ),
        onChanged: (v) {
          setState(() {
            _search = v;
            _applyFilter();
          });
        },
      ),
    );
  }

  Widget _buildBody() {
    switch (_tab.index) {
      case 0:
        return _buildTodayTab();
      case 1:
        return _buildConceptosTab();
      case 2:
        return _buildDraftsTab();
      case 3:
      default:
        return _buildAllTab();
    }
  }

  // ── TAB 1: HOY (due + nuevas) ───────────────────────────────────────

  Widget _buildTodayTab() {
    final due = _all.where((c) => c.isDue && c.approved).toList()
      ..sort((a, b) => (a.nextReview ?? DateTime.now())
          .compareTo(b.nextReview ?? DateTime.now()));
    final fresh = _all.where((c) => c.nextReview == null && c.approved).toList();

    if (due.isEmpty && fresh.isEmpty) {
      return EmptyState(
        icon: Icons.celebration_rounded,
        title: '¡Al día!',
        subtitle: 'No hay tarjetas pendientes. Probá crear conceptos nuevos desde la pestaña Conceptos.',
        action: OutlinedButton.icon(
          onPressed: () => _tab.animateTo(1),
          icon: const Icon(Icons.lightbulb_outline_rounded, size: 18),
          label: const Text('Ver conceptos'),
        ),
      );
    }

    final items = [...due, ...fresh];

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(MxSpacing.lg, MxSpacing.md, MxSpacing.lg, 96),
      itemCount: items.length + (due.isNotEmpty ? 1 : 0) + (fresh.isNotEmpty ? 1 : 0),
      separatorBuilder: (_, __) => const SizedBox(height: MxSpacing.sm),
      itemBuilder: (ctx, i) {
        int idx = i;
        if (due.isNotEmpty && idx == 0) {
          return _SectionLabel(label: 'Vencidas', count: due.length, color: const Color(0xFFEF4444));
        }
        idx -= due.isNotEmpty ? 1 : 0;
        if (fresh.isNotEmpty && idx == due.length) {
          return _SectionLabel(label: 'Nuevas', count: fresh.length, color: const Color(0xFF06B6D4));
        }
        idx -= fresh.isNotEmpty ? 1 : 0;
        return _FlashcardRow(
          card: items[idx],
          isDue: items[idx].isDue,
          isNew: items[idx].nextReview == null,
          onTap: () => _openEdit(items[idx]),
          onReview: () => _startReview([items[idx]]),
          onDelete: () => _confirmDelete(items[idx]),
          onApprove: !items[idx].approved ? () async {
            await _service!.approve(items[idx]);
            _load();
          } : null,
        );
      },
    );
  }

  // ── TAB 2: CONCEPTOS (autoevaluación) ───────────────────────────────

  Widget _buildConceptosTab() {
    if (_conceptCandidates.isEmpty) {
      return EmptyState(
        icon: Icons.lightbulb_outline_rounded,
        title: 'Sin conceptos por aprender',
        subtitle: 'Añadí **términos en negrita** o secciones ## Subtítulo en tus notas para que aparezcan aquí como candidatos a flashcard.',
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(MxSpacing.lg, MxSpacing.md, MxSpacing.lg, 96),
      itemCount: _conceptCandidates.length + 1,
      separatorBuilder: (_, __) => const SizedBox(height: MxSpacing.sm),
      itemBuilder: (ctx, i) {
        if (i == 0) {
          return Container(
            padding: const EdgeInsets.all(MxSpacing.md),
            decoration: BoxDecoration(
              color: MxColors.violet.withOpacity(0.08),
              borderRadius: BorderRadius.circular(MxRadius.md),
              border: Border.all(color: MxColors.violet.withOpacity(0.3)),
            ),
            child: Row(
              children: [
                const Icon(Icons.auto_awesome_rounded, size: 18, color: MxColors.violet),
                const SizedBox(width: MxSpacing.sm),
                Expanded(
                  child: Text(
                    'Términos extraídos de tus notas que aún no tienen flashcard. Tocá uno para crearla — el sistema de autoevaluación te las mostrará después en "Hoy".',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: MxColors.violet,
                        ),
                  ),
                ),
              ],
            ),
          );
        }
        final c = _conceptCandidates[i - 1];
        return _ConceptRow(
          candidate: c,
          onTap: () => _createFromConcept(c),
        );
      },
    );
  }

  // ── TAB 3: APROBAR (drafts) ─────────────────────────────────────────

  Widget _buildDraftsTab() {
    final drafts = _all.where((c) => !c.approved).toList();
    if (drafts.isEmpty) {
      return const EmptyState(
        icon: Icons.task_alt_rounded,
        title: 'Nada por aprobar',
        subtitle: 'Las tarjetas auto-generadas aparecerán aquí para revisión.',
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(MxSpacing.lg, MxSpacing.md, MxSpacing.lg, 96),
      itemCount: drafts.length,
      separatorBuilder: (_, __) => const SizedBox(height: MxSpacing.sm),
      itemBuilder: (ctx, i) {
        final c = drafts[i];
        return _FlashcardRow(
          card: c,
          isDue: false,
          isNew: true,
          isDraft: true,
          onTap: () => _openEdit(c),
          onReview: () => _startReview([c]),
          onDelete: () => _confirmDelete(c),
          onApprove: () async {
            await _service!.approve(c);
            _load();
          },
        );
      },
    );
  }

  // ── TAB 4: TODAS ────────────────────────────────────────────────────

  Widget _buildAllTab() {
    if (_filtered.isEmpty) {
      return EmptyState(
        icon: Icons.style,
        title: 'Sin tarjetas',
        subtitle: 'Tocá + para crear una, o andá a "Conceptos" para generarlas desde tus notas.',
        action: FilledButton.icon(
          onPressed: _createNote,
          icon: const Icon(Icons.add_rounded),
          label: const Text('Crear primera'),
        ),
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(MxSpacing.lg, MxSpacing.md, MxSpacing.lg, 96),
      itemCount: _filtered.length,
      separatorBuilder: (_, __) => const SizedBox(height: MxSpacing.sm),
      itemBuilder: (ctx, i) {
        final c = _filtered[i];
        return _FlashcardRow(
          card: c,
          isDue: c.isDue,
          isNew: c.nextReview == null,
          isDraft: !c.approved,
          onTap: () => _openEdit(c),
          onReview: () => _startReview([c]),
          onDelete: () => _confirmDelete(c),
          onApprove: !c.approved ? () async {
            await _service!.approve(c);
            _load();
          } : null,
        );
      },
    );
  }

  Widget? _buildFab() {
    if (_tab.index == 1) return null; // en Conceptos no tiene sentido
    return FloatingActionButton.extended(
      onPressed: _createNote,
      icon: const Icon(Icons.add_rounded),
      label: const Text('Nueva tarjeta'),
      backgroundColor: MxColors.indigoDeep,
      foregroundColor: Colors.white,
    );
  }

  // ── ACTIONS ──────────────────────────────────────────────────────────

  void _openEdit(Flashcard c) {
    Navigator.push(context, MaterialPageRoute(
      builder: (_) => FlashcardEdit(
        service: _service!,
        existing: c,
        onSaved: _load,
      ),
    ));
  }

  void _startReview(List<Flashcard> cards) {
    if (cards.isEmpty) return;
    Navigator.push(context, MaterialPageRoute(
      builder: (_) => FlashcardReview(
        cards: cards,
        service: _service!,
        onFinish: _load,
      ),
    ));
  }

  Future<void> _confirmDelete(Flashcard c) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('¿Eliminar tarjeta?'),
        content: Text('"${c.question}" se eliminará permanentemente.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
    if (ok == true) {
      await _service!.delete(c);
      _load();
    }
  }

  Future<void> _createNote() async {
    final path = await Navigator.push(context, MaterialPageRoute(
      builder: (_) => FlashcardEdit(
        service: _service!,
        onSaved: _load,
      ),
    ));
    if (path != null) _load();
  }

  Future<void> _createFromConcept(_ConceptCandidate c) async {
    // Pre-llenar el form con el término como question.
    final created = await Navigator.push<bool>(context, MaterialPageRoute(
      builder: (_) => FlashcardEdit(
        service: _service!,
        initialQuestion: c.term,
        onSaved: _load,
      ),
    ));
    if (created == true) {
      setState(() {
        _conceptCandidates.removeWhere((x) => x.term == c.term);
      });
      _load();
    }
  }
}

// ── MODELOS AUXILIARES ────────────────────────────────────────────────

class _ConceptCandidate {
  final String term;
  final String sourcePath;
  int count;
  _ConceptCandidate({required this.term, required this.sourcePath, required this.count});
}

// ── SUBCOMPONENTES ───────────────────────────────────────────────────

class _SectionLabel extends StatelessWidget {
  final String label;
  final int count;
  final Color color;
  const _SectionLabel({required this.label, required this.count, required this.color});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: MxSpacing.md, bottom: MxSpacing.xs),
      child: Row(
        children: [
          Container(
            width: 8, height: 8,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: MxSpacing.sm),
          Text(
            label,
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: color,
                ),
          ),
          const SizedBox(width: MxSpacing.sm),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: color.withOpacity(0.12),
              borderRadius: BorderRadius.circular(MxRadius.pill),
            ),
            child: Text(
              '$count',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: color,
                    fontWeight: FontWeight.w700,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

class _FlashcardRow extends StatelessWidget {
  final Flashcard card;
  final bool isDue;
  final bool isNew;
  final bool isDraft;
  final VoidCallback onTap;
  final VoidCallback onReview;
  final VoidCallback onDelete;
  final VoidCallback? onApprove;
  const _FlashcardRow({
    required this.card,
    required this.isDue,
    required this.isNew,
    required this.onTap,
    required this.onReview,
    required this.onDelete,
    this.isDraft = false,
    this.onApprove,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final accentColor = isDue
        ? const Color(0xFFEF4444)
        : isDraft
            ? const Color(0xFFF59E0B)
            : isNew
                ? const Color(0xFF06B6D4)
                : MxColors.indigoDeep;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(MxRadius.lg),
      child: AnimatedContainer(
        duration: MxMotion.fast,
        curve: MxMotion.standard,
        padding: const EdgeInsets.all(MxSpacing.md),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerLow.withOpacity(0.4),
          borderRadius: BorderRadius.circular(MxRadius.lg),
          border: Border.all(
            color: accentColor.withOpacity(isDue || isDraft || isNew ? 0.4 : 0.2),
            width: 1,
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Difficulty badge
            Container(
              width: 40, height: 40,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    accentColor.withOpacity(0.18),
                    accentColor.withOpacity(0.08),
                  ],
                ),
                borderRadius: BorderRadius.circular(MxRadius.md),
              ),
              alignment: Alignment.center,
              child: Text(
                '${card.difficulty}',
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 16,
                  color: accentColor,
                ),
              ),
            ),
            const SizedBox(width: MxSpacing.md),
            // Question + meta
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    card.question,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                      height: 1.3,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: accentColor.withOpacity(0.15),
                          borderRadius: BorderRadius.circular(MxRadius.pill),
                        ),
                        child: Text(
                          isDue
                              ? 'Vencida'
                              : isDraft
                                  ? 'Borrador'
                                  : isNew
                                      ? 'Nueva'
                                      : _rel(card.nextReview),
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                            color: accentColor,
                          ),
                        ),
                      ),
                      const SizedBox(width: MxSpacing.sm),
                      Icon(
                        Icons.bolt_rounded,
                        size: 11,
                        color: scheme.onSurfaceVariant,
                      ),
                      const SizedBox(width: 2),
                      Text(
                        'S=${card.stability.toStringAsFixed(1)}',
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                          fontFamily: 'monospace',
                        ),
                      ),
                      if (card.reps > 0) ...[
                        const SizedBox(width: MxSpacing.sm),
                        Icon(
                          Icons.repeat_rounded,
                          size: 11,
                          color: scheme.onSurfaceVariant,
                        ),
                        const SizedBox(width: 2),
                        Text(
                          '${card.reps}×',
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            // Trailing
            Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  icon: const Icon(Icons.play_arrow_rounded, size: 20),
                  onPressed: onReview,
                  tooltip: 'Repasar',
                  visualDensity: VisualDensity.compact,
                ),
                if (onApprove != null)
                  IconButton(
                    icon: const Icon(Icons.task_alt_rounded, size: 20, color: Color(0xFF10B981)),
                    onPressed: onApprove,
                    tooltip: 'Aprobar',
                    visualDensity: VisualDensity.compact,
                  ),
                IconButton(
                  icon: Icon(Icons.delete_outline_rounded, size: 20, color: scheme.onSurfaceVariant),
                  onPressed: onDelete,
                  tooltip: 'Eliminar',
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _rel(DateTime? d) {
    if (d == null) return 'Sin fecha';
    final diff = d.difference(DateTime.now()).inDays;
    if (diff < 0) return 'hace ${-diff}d';
    if (diff == 0) return 'hoy';
    if (diff == 1) return 'mañana';
    return 'en ${diff}d';
  }
}

class _ConceptRow extends StatelessWidget {
  final _ConceptCandidate candidate;
  final VoidCallback onTap;
  const _ConceptRow({required this.candidate, required this.onTap});
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(MxRadius.lg),
      child: Container(
        padding: const EdgeInsets.all(MxSpacing.md),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerLow.withOpacity(0.4),
          borderRadius: BorderRadius.circular(MxRadius.lg),
          border: Border.all(
            color: MxColors.violet.withOpacity(0.25),
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 36, height: 36,
              decoration: BoxDecoration(
                color: MxColors.violet.withOpacity(0.15),
                borderRadius: BorderRadius.circular(MxRadius.sm),
              ),
              alignment: Alignment.center,
              child: const Icon(
                Icons.lightbulb_outline_rounded,
                size: 18,
                color: MxColors.violet,
              ),
            ),
            const SizedBox(width: MxSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    candidate.term,
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Aparece ${candidate.count}× en tus notas',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(Icons.add_rounded, size: 18, color: MxColors.violet),
          ],
        ),
      ),
    );
  }
}
