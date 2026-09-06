// HomeScreen: dashboard principal.
// Dashboard: stats + recientes + acciones rápidas.

import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:path/path.dart' as p;
import '../../core/constants.dart';
import '../../core/shortcuts.dart';
import '../../core/theme.dart';
import '../../services/app_info.dart';
import '../../services/flashcard_service.dart';
import '../../services/vault_detector.dart';
import '../../services/vault_service.dart';
import '../../services/logger.dart';
import '../../state/app_state.dart';
import '../../widgets/empty_state.dart';
import '../note/note_view.dart';
import '../note/note_editor.dart';
import '../flashcards/flashcard_review.dart';
import '../flashcards/flashcard_edit.dart';
import '../vault/vault_browser.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  VaultService? _vault;
  FlashcardService? _fc;
  int _noteCount = 0;
  int _flashcardCount = 0;
  int _dueCount = 0;
  List<Note> _recent = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final log = AdvancedLogger.instance;
    try {
      // Detectar vault
      final detector = VaultDetector();
      final vaults = await detector.detectVaults();
      if (!mounted) return;
      if (vaults.isEmpty) {
        setState(() {
          _loading = false;
          _error = 'No hay vault';
        });
        return;
      }
      _vault = VaultService(vaults.first.path);
      _fc = FlashcardService(vaults.first.path);

      _noteCount = await _vault!.countNotes();
      if (!mounted) return;
      final allCards = await _fc!.listAll();
      _flashcardCount = allCards.length;
      _dueCount = allCards.where((c) => c.isDue).length;

      // Últimas 5 notas modificadas
      final tree = await _vault!.loadTree();
      final mdFiles = <String>[];
      void walk(VaultNode n) {
        if (!n.isDir) mdFiles.add(n.relPath);
        for (final c in n.children) walk(c);
      }
      walk(tree);
      final notes = <Note>[];
      for (final rel in mdFiles) {
        final n = await _vault!.readNote(p.join(vaults.first.path, rel));
        if (n != null) notes.add(n);
      }
      notes.sort((a, b) => b.modified.compareTo(a.modified));
      _recent = notes.take(5).toList();

      if (!mounted) return;
      setState(() { _loading = false; });
    } catch (e, s) {
      log.error('home', 'Load failed', error: e, stack: s);
      if (!mounted) return;
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _createNewNote() async {
    if (_vault == null) return;
    final path = await _vault!.createNote(
      folder: 'Inbox',
      title: 'Sin título',
      content: '# Sin título\n\nEmpezá a escribir…\n',
    );
    if (!mounted) return;
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => NoteEditor(
        notePath: path,
        vaultPath: _vault!.vaultPath,
      )),
    );
    _load();
  }

  Future<void> _reviewDue() async {
    if (_fc == null) return;
    final due = await _fc!.dueCards();
    if (!mounted) return;
    if (due.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No hay tarjetas para repasar')),
      );
      return;
    }
    if (!mounted) return;
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => FlashcardReview(cards: due, service: _fc!)),
    );
    _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(message: 'Cargando…');
    if (_error != null) {
      return EmptyState(
        icon: Icons.folder_off,
        title: 'Sin vault',
        subtitle: _error,
        action: FilledButton(
          onPressed: _load,
          child: const Text('Reintentar'),
        ),
      );
    }
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: EdgeInsets.fromLTRB(
            20, 0, 20,
            MediaQuery.paddingOf(context).bottom + 24,
          ),
          children: [
            _buildGreeting(),
            const SizedBox(height: 16),
            _buildStats(),
            const SizedBox(height: 24),
            _buildQuickActions(),
            const SizedBox(height: 24),
            _buildRecent(),
            const SizedBox(height: 24),
            _buildShortcutsHint(),
          ],
        ),
      ),
    );
  }

  Widget _buildGreeting() {
    final h = DateTime.now().hour;
    final greeting = h < 12 ? 'Buenos días' : h < 18 ? 'Buenas tardes' : 'Buenas noches';
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(greeting, style: Theme.of(context).textTheme.bodyLarge),
          const SizedBox(height: 2),
          Text('¿Qué querés aprender hoy?',
            style: Theme.of(context).textTheme.headlineMedium),
        ],
      ),
    );
  }

  Widget _buildStats() {
    return Row(
      children: [
        Expanded(child: StatCard(
          icon: Icons.description_outlined,
          label: 'Notas',
          value: '$_noteCount',
          color: const Color(0xFF4F6BED),
        )),
        const SizedBox(width: 10),
        Expanded(child: StatCard(
          icon: Icons.style_outlined,
          label: 'Tarjetas',
          value: '$_flashcardCount',
          subtitle: _dueCount > 0 ? '$_dueCount para repasar' : 'al día',
          color: _dueCount > 0 ? const Color(0xFFEF6C00) : const Color(0xFF2E7D32),
        )),
      ],
    );
  }

  Widget _buildQuickActions() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(title: 'Acciones'),
        const SizedBox(height: 8),
        Card(
          child: Column(
            children: [
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: const Color(0xFF4F6BED).withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(Icons.add, color: Color(0xFF4F6BED), size: 20),
                ),
                title: const Text('Nueva nota'),
                subtitle: const Text('Ctrl+N'),
                trailing: const ShortcutChip(label: 'Ctrl+N'),
                onTap: _createNewNote,
              ),
              const Divider(height: 1),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEF6C00).withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(Icons.psychology, color: Color(0xFFEF6C00), size: 20),
                ),
                title: Text(_dueCount > 0
                    ? 'Repasar $_dueCount tarjetas'
                    : 'Tarjetas al día'),
                subtitle: Text(_dueCount > 0
                    ? 'Ctrl+R'
                    : 'Andá a la pestaña Tarjetas'),
                trailing: _dueCount > 0
                    ? const ShortcutChip(label: 'Ctrl+R')
                    : Icon(Icons.check, color: Colors.green),
                onTap: _reviewDue,
              ),
              const Divider(height: 1),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: const Color(0xFF7B5BE6).withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(Icons.add_box_outlined, color: Color(0xFF7B5BE6), size: 20),
                ),
                title: const Text('Nueva flashcard'),
                subtitle: const Text('Empezar a estudiar'),
                onTap: () async {
                  if (_fc == null) return;
                  await Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => FlashcardEdit(
                      service: _fc!,
                      onSaved: _load,
                    )),
                  );
                },
              ),
              const Divider(height: 1),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: const Color(0xFF2E7D32).withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(Icons.folder_open, color: Color(0xFF2E7D32), size: 20),
                ),
                title: const Text('Explorar vault'),
                subtitle: const Text('Ctrl+2'),
                trailing: const ShortcutChip(label: 'Ctrl+2'),
                onTap: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const VaultBrowser()),
                  );
                },
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildRecent() {
    if (_recent.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(title: 'Recientes'),
        const SizedBox(height: 8),
        Card(
          child: Column(
            children: _recent.map((n) {
              return Column(
                children: [
                  ListTile(
                    leading: Icon(Icons.description_outlined),
                    title: Text(n.title ?? n.name, maxLines: 1, overflow: TextOverflow.ellipsis),
                    subtitle: Text(n.preview, maxLines: 1, overflow: TextOverflow.ellipsis),
                    trailing: Text(_timeAgo(n.modified),
                      style: Theme.of(context).textTheme.bodySmall),
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => NoteView(notePath: n.path, vaultPath: _vault!.vaultPath)),
                    ),
                  ),
                  if (n != _recent.last) const Divider(height: 1),
                ],
              );
            }).toList(),
          ),
        ),
      ],
    );
  }

  Widget _buildShortcutsHint() {
    if (AppTheme.isMobile(context)) return const SizedBox.shrink();
    return Card(
      color: Theme.of(context).colorScheme.surfaceContainerLow,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Atajos de teclado', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            Wrap(
              spacing: 16,
              runSpacing: 8,
              children: const [
                _ShortcutRow(label: 'Nueva nota', shortcut: 'Ctrl+N'),
                _ShortcutRow(label: 'Buscar', shortcut: 'Ctrl+Shift+P'),
                _ShortcutRow(label: 'Repasar tarjetas', shortcut: 'Ctrl+R'),
                _ShortcutRow(label: 'Ir a Inicio', shortcut: 'Ctrl+1'),
                _ShortcutRow(label: 'Ir a Vault', shortcut: 'Ctrl+2'),
                _ShortcutRow(label: 'Ir a Tarjetas', shortcut: 'Ctrl+3'),
                _ShortcutRow(label: 'Ir a Ajustes', shortcut: 'Ctrl+4'),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _timeAgo(DateTime d) {
    final diff = DateTime.now().difference(d);
    if (diff.inMinutes < 60) return 'hace ${diff.inMinutes}m';
    if (diff.inHours < 24) return 'hace ${diff.inHours}h';
    if (diff.inDays < 7) return 'hace ${diff.inDays}d';
    return '${d.day}/${d.month}';
  }
}

class _ShortcutRow extends StatelessWidget {
  final String label;
  final String shortcut;
  const _ShortcutRow({required this.label, required this.shortcut});
  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(label, style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(width: 6),
        ShortcutChip(label: shortcut),
      ],
    );
  }
}
