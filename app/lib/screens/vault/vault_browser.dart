// VaultBrowser v0.62.11 — Notion-style vault browser.
//
// Layout: sidebar (tree colapsable) + main area (list/cards de items con
// metadata) + (desktop only) detail panel preview. Mobile muestra un
// drawer lateral y todo el ancho en main.
//
// Filtros: chip-row arriba (Todas / Recientes / Favoritas / por tipo).
// Items: cada uno muestra título + snippet (primer párrafo o frontmatter
// description) + metadata (modificado, palabras, tags, icono por tipo).
//
// Acciones globales: + nota, + carpeta, importar (Anki/PDF), refresh.

import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import '../../core/design_tokens.dart';
import '../../core/theme.dart';
import '../../services/vault_detector.dart';
import '../../services/permissions.dart';
import '../../services/vault_service.dart';
import '../../services/logger.dart';
import '../../utils/safe_call.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/glass_widgets.dart';
import '../note/note_view.dart';
import '../note/note_editor.dart';

class VaultBrowser extends StatefulWidget {
  const VaultBrowser({super.key});
  @override
  State<VaultBrowser> createState() => _VaultBrowserState();
}

class _VaultBrowserState extends State<VaultBrowser> {
  VaultService? _vault;
  VaultNode? _tree;
  bool _loading = true;
  String? _selectedRelPath;
  String _filter = '';
  String _scope = 'all'; // all | recent | favorites | by-folder | by-tag
  String? _scopeValue; // folder relPath or tag name
  final TextEditingController _searchCtrl = TextEditingController();
  final Set<String> _expanded = {};
  final Set<String> _favorites = {}; // relPath de notas marcadas favoritas

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; });
    final log = AdvancedLogger.instance;
    try {
      log.debug('vault_browser', '_load start');
      final detector = VaultDetector();
      final vaults = await detector.detectVaults();
      if (!mounted) return;
      log.debug('vault_browser', 'vaults detected', context: {'count': vaults.length});
      if (vaults.isEmpty) {
        setState(() { _loading = false; });
        return;
      }
      _vault = VaultService(vaults.first.path);
      _tree = await _vault!.loadTree();
      log.debug('vault_browser', 'tree loaded', context: {
        'vault': vaults.first.path,
        'children': _tree?.children.length ?? 0,
      });
    } catch (e, s) {
      log.error('vault_browser', '[EC-UI-002] Load vault tree failed', error: e, stack: s);
    }
    if (!mounted) return;
    setState(() { _loading = false; });
  }

  Future<void> _refreshVault() async {
    if (_vault == null) return;
    _vault!.invalidateCache();
    final tree = await _vault!.loadTree();
    if (!mounted) return;
    setState(() { _tree = tree; });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(message: 'Cargando vault…');
    if (_vault == null || _tree == null) {
      return const EmptyState(
        icon: Icons.folder_off,
        title: 'Sin vault',
        subtitle: 'No se detectaron vaults. Configurá uno en Ajustes.',
      );
    }
    final isMobile = AppTheme.isMobile(context);
    if (isMobile) return _buildMobileLayout();
    return _buildDesktopLayout();
  }

  // ── MOBILE ───────────────────────────────────────────────────────────

  Widget _buildMobileLayout() {
    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Container(
              width: 28, height: 28,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF5B5BD6), Color(0xFF8B5CF6)],
                ),
                borderRadius: BorderRadius.circular(8),
              ),
              alignment: Alignment.center,
              child: const Icon(Icons.folder_rounded, size: 16, color: Colors.white),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                p.basename(_vault!.vaultPath),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.create_new_folder_outlined),
            onPressed: _createFolder,
            tooltip: 'Nueva carpeta',
          ),
          IconButton(
            icon: const Icon(Icons.file_upload_outlined),
            onPressed: _showImportDialog,
            tooltip: 'Importar',
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert_rounded),
            onSelected: (v) {
              if (v == 'refresh') _refreshVault();
            },
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'refresh', child: Text('Recargar vault')),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          _buildSearchAndFilters(),
          _buildBreadcrumb(),
          const Divider(height: 1),
          Expanded(child: _buildItemsList()),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _createNote,
        icon: const Icon(Icons.add_rounded),
        label: const Text('Nueva nota'),
        backgroundColor: MxColors.indigoDeep,
        foregroundColor: Colors.white,
      ),
    );
  }

  // ── DESKTOP ──────────────────────────────────────────────────────────

  Widget _buildDesktopLayout() {
    return Scaffold(
      body: Row(
        children: [
          // Sidebar con tree
          Container(
            width: 280,
            decoration: BoxDecoration(
              border: Border(
                right: BorderSide(
                  color: Theme.of(context).dividerColor.withOpacity(0.5),
                ),
              ),
            ),
            child: Column(
              children: [
                _buildSidebarHeader(),
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                  child: TextField(
                    controller: _searchCtrl,
                    decoration: InputDecoration(
                      hintText: 'Buscar…',
                      prefixIcon: const Icon(Icons.search_rounded, size: 18),
                      suffixIcon: _filter.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.clear_rounded, size: 18),
                              onPressed: () {
                                _searchCtrl.clear();
                                setState(() => _filter = '');
                              },
                            )
                          : null,
                      isDense: true,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(MxRadius.md),
                      ),
                    ),
                    onChanged: (v) => setState(() => _filter = v.toLowerCase()),
                  ),
                ),
                Expanded(
                  child: _buildTreeWidget(_tree!, root: true),
                ),
              ],
            ),
          ),
          // Main area
          Expanded(
            flex: 3,
            child: Column(
              children: [
                _buildBreadcrumb(),
                _buildSearchAndFilters(),
                const Divider(height: 1),
                Expanded(child: _buildItemsList()),
              ],
            ),
          ),
          // Detail panel (solo si algo seleccionado)
          if (_selectedRelPath != null)
            Container(
              width: 420,
              decoration: BoxDecoration(
                border: Border(
                  left: BorderSide(
                    color: Theme.of(context).dividerColor.withOpacity(0.5),
                  ),
                ),
              ),
              child: _buildDetailPanel(),
            ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _createNote,
        icon: const Icon(Icons.add_rounded),
        label: const Text('Nueva nota'),
        backgroundColor: MxColors.indigoDeep,
        foregroundColor: Colors.white,
      ),
    );
  }

  // ── SIDEBAR ──────────────────────────────────────────────────────────

  Widget _buildSidebarHeader() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 12),
      child: Row(
        children: [
          Container(
            width: 32, height: 32,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF5B5BD6), Color(0xFF8B5CF6)],
              ),
              borderRadius: BorderRadius.circular(MxRadius.sm),
              boxShadow: MxShadows.sm,
            ),
            alignment: Alignment.center,
            child: const Icon(Icons.folder_rounded, size: 18, color: Colors.white),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              p.basename(_vault!.vaultPath),
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.2,
                  ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          IconButton(
            icon: const Icon(Icons.add_rounded, size: 20),
            onPressed: _createNote,
            tooltip: 'Nueva nota',
            visualDensity: VisualDensity.compact,
          ),
        ],
      ),
    );
  }

  Widget _buildTreeWidget(VaultNode node, {bool root = false}) {
    if (node.isDir) {
      final key = node.relPath.isEmpty ? '__root__' : node.relPath;
      final isExpanded = _expanded.contains(key) || _filter.isNotEmpty;
      return Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          initiallyExpanded: root || _expanded.contains(key) || _filter.isNotEmpty,
          onExpansionChanged: (e) {
            setState(() {
              if (e) {
                _expanded.add(key);
              } else {
                _expanded.remove(key);
              }
            });
          },
          leading: Icon(
            isExpanded ? Icons.folder_open_rounded : Icons.folder_rounded,
            size: 18,
            color: const Color(0xFFFBBF24),
          ),
          title: Text(
            root ? p.basename(_vault!.vaultPath) : node.name,
            style: TextStyle(
              fontWeight: root ? FontWeight.w700 : FontWeight.w500,
              fontSize: 14,
            ),
            overflow: TextOverflow.ellipsis,
          ),
          trailing: _buildFolderActions(node),
          children: [
            // Filtro silencioso: si hay filtro, solo hijos que matchean
            ...node.children
                .where((c) => _matchesFilter(c))
                .map((c) => _buildTreeWidget(c)),
          ],
        ),
      );
    }
    final selected = _selectedRelPath == node.relPath;
    return InkWell(
      onTap: () => _openNote(node),
      onLongPress: () => _showNoteContextMenu(node),
      borderRadius: BorderRadius.circular(MxRadius.sm),
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 1),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        decoration: BoxDecoration(
          color: selected
              ? MxColors.indigoDeep.withOpacity(0.15)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(MxRadius.sm),
          border: selected
              ? Border.all(color: MxColors.indigoDeep.withOpacity(0.3))
              : null,
        ),
        child: Row(
          children: [
            Icon(
              Icons.description_outlined,
              size: 16,
              color: selected ? MxColors.indigoSoft : Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                node.name.replaceAll('.md', ''),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                  color: selected ? MxColors.indigoSoft : null,
                ),
              ),
            ),
            if (_favorites.contains(node.relPath))
              const Icon(Icons.star_rounded, size: 12, color: Color(0xFFFBBF24)),
          ],
        ),
      ),
    );
  }

  Widget _buildFolderActions(VaultNode node) {
    return PopupMenuButton<String>(
      icon: const Icon(Icons.more_horiz_rounded, size: 16),
      padding: EdgeInsets.zero,
      onSelected: (v) {
        if (v == 'rename') _renameFolder(node);
        if (v == 'delete') _deleteFolder(node);
      },
      itemBuilder: (_) => [
        const PopupMenuItem(value: 'rename', child: Text('Renombrar')),
        const PopupMenuItem(value: 'delete', child: Text('Eliminar', style: TextStyle(color: Colors.red))),
      ],
    );
  }

  // ── SEARCH + FILTERS ─────────────────────────────────────────────────

  Widget _buildSearchAndFilters() {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(MxSpacing.lg, MxSpacing.md, MxSpacing.lg, MxSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (AppTheme.isMobile(context))
            Padding(
              padding: const EdgeInsets.only(bottom: MxSpacing.sm),
              child: TextField(
                controller: _searchCtrl,
                decoration: InputDecoration(
                  hintText: 'Buscar en vault…',
                  prefixIcon: const Icon(Icons.search_rounded, size: 18),
                  suffixIcon: _filter.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear_rounded, size: 18),
                          onPressed: () {
                            _searchCtrl.clear();
                            setState(() => _filter = '');
                          },
                        )
                      : null,
                  isDense: true,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(MxRadius.md),
                  ),
                ),
                onChanged: (v) => setState(() => _filter = v.toLowerCase()),
              ),
            ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _ScopeChip(
                  label: 'Todas',
                  icon: Icons.all_inbox_rounded,
                  selected: _scope == 'all',
                  onTap: () => setState(() { _scope = 'all'; _scopeValue = null; }),
                ),
                const SizedBox(width: MxSpacing.sm),
                _ScopeChip(
                  label: 'Recientes',
                  icon: Icons.schedule_rounded,
                  selected: _scope == 'recent',
                  onTap: () => setState(() { _scope = 'recent'; _scopeValue = null; }),
                ),
                const SizedBox(width: MxSpacing.sm),
                _ScopeChip(
                  label: 'Favoritas',
                  icon: Icons.star_rounded,
                  selected: _scope == 'favorites',
                  onTap: () => setState(() { _scope = 'favorites'; _scopeValue = null; }),
                ),
                const SizedBox(width: MxSpacing.sm),
                ..._collectTags().take(5).map((tag) => Padding(
                      padding: const EdgeInsets.only(right: MxSpacing.sm),
                      child: _ScopeChip(
                        label: '#$tag',
                        icon: Icons.tag_rounded,
                        selected: _scope == 'by-tag' && _scopeValue == tag,
                        onTap: () => setState(() { _scope = 'by-tag'; _scopeValue = tag; }),
                      ),
                    )),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBreadcrumb() {
    if (_scope == 'all' && _filter.isEmpty && !AppTheme.isMobile(context)) {
      return const SizedBox.shrink();
    }
    String label = 'Todas';
    if (_scope == 'recent') label = 'Recientes';
    if (_scope == 'favorites') label = 'Favoritas';
    if (_scope == 'by-tag' && _scopeValue != null) label = '#$_scopeValue';
    return Padding(
      padding: const EdgeInsets.fromLTRB(MxSpacing.lg, MxSpacing.sm, MxSpacing.lg, 0),
      child: Row(
        children: [
          Icon(
            _scope == 'recent'
                ? Icons.schedule_rounded
                : _scope == 'favorites'
                    ? Icons.star_rounded
                    : _scope == 'by-tag'
                        ? Icons.tag_rounded
                        : Icons.all_inbox_rounded,
            size: 16,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
          const SizedBox(width: MxSpacing.sm),
          Text(
            label,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
          ),
          const SizedBox(width: MxSpacing.sm),
          Text(
            '· ${_filteredItems().length} ${_filteredItems().length == 1 ? "item" : "items"}',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
        ],
      ),
    );
  }

  // ── ITEMS LIST ───────────────────────────────────────────────────────

  List<VaultNode> _filteredItems() {
    if (_tree == null) return [];
    final all = <VaultNode>[];
    void walk(VaultNode n) {
      if (!n.isDir) {
        all.add(n);
      } else {
        for (final c in n.children) walk(c);
      }
    }
    walk(_tree!);
    var filtered = all;
    // Texto
    if (_filter.isNotEmpty) {
      filtered = filtered.where((n) => n.name.toLowerCase().contains(_filter)).toList();
    }
    // Scope
    if (_scope == 'recent') {
      filtered = filtered.toList()
        ..sort((a, b) => _modifiedOf(b).compareTo(_modifiedOf(a)));
      filtered = filtered.take(20).toList();
    } else if (_scope == 'favorites') {
      filtered = filtered.where((n) => _favorites.contains(n.relPath)).toList();
    } else if (_scope == 'by-tag' && _scopeValue != null) {
      // Tag filter sería async (leer frontmatter); simplificamos: mostrar
      // archivos cuyo nombre contenga el tag como substring (rápido).
      filtered = filtered.where((n) => n.name.toLowerCase().contains(_scopeValue!.toLowerCase())).toList();
    } else {
      filtered = filtered.toList()..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    }
    return filtered;
  }

  Widget _buildItemsList() {
    final items = _filteredItems();
    if (items.isEmpty) {
      return EmptyState(
        icon: Icons.search_off_rounded,
        title: _filter.isNotEmpty ? 'Sin resultados' : 'Vault vacío',
        subtitle: _filter.isNotEmpty
            ? 'Probá con otro término de búsqueda.'
            : 'Tocá + para crear tu primera nota.',
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(MxSpacing.lg, MxSpacing.sm, MxSpacing.lg, MxSpacing.xxxl),
      itemCount: items.length,
      separatorBuilder: (_, __) => const SizedBox(height: MxSpacing.sm),
      itemBuilder: (ctx, i) {
        final n = items[i];
        return _VaultItemRow(
          node: n,
          vault: _vault!,
          selected: _selectedRelPath == n.relPath,
          isFavorite: _favorites.contains(n.relPath),
          onTap: () => _openNote(n),
          onLongPress: () => _showNoteContextMenu(n),
          onToggleFavorite: () {
            setState(() {
              if (_favorites.contains(n.relPath)) {
                _favorites.remove(n.relPath);
              } else {
                _favorites.add(n.relPath);
              }
            });
          },
        );
      },
    );
  }

  // ── DETAIL PANEL (desktop) ───────────────────────────────────────────

  Widget _buildDetailPanel() {
    final absPath = p.join(_vault!.vaultPath, _selectedRelPath!);
    return NoteView(notePath: absPath, vaultPath: _vault!.vaultPath, embedded: true);
  }

  // ── ACTIONS ──────────────────────────────────────────────────────────

  void _openNote(VaultNode n) {
    final absPath = p.join(_vault!.vaultPath, n.relPath);
    if (AppTheme.isMobile(context)) {
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => NoteView(notePath: absPath, vaultPath: _vault!.vaultPath),
        ),
      );
    } else {
      setState(() { _selectedRelPath = n.relPath; });
    }
  }

  Future<void> _createNote() async {
    if (_vault == null) return;
    if (_vault!.vaultPath.startsWith('/storage/emulated/0/')) {
      final granted = await PermissionsService.isManageStorageGranted();
      if (!granted && mounted) {
        final ok = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Permiso necesario'),
            content: const Text(
              'Para escribir en /storage/emulated/0/ necesitamos '
              '"Acceso a todos los archivos". ¿Lo activamos?',
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
              FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Abrir ajustes')),
            ],
          ),
        );
        if (ok != true) return;
        await PermissionsService.openManageStorageSettings();
        return;
      }
    }
    try {
      final path = await _vault!.createNote(
        folder: 'Inbox',
        title: 'Sin título',
        content: '# Sin título\n\n',
      );
      if (!mounted) return;
      await Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => NoteEditor(notePath: path, vaultPath: _vault!.vaultPath)),
      );
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('No se pudo crear la nota: $e')),
      );
    }
  }

  Future<void> _createFolder() async {
    if (_vault == null) return;
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Nueva carpeta'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Nombre'),
          onSubmitted: (v) => Navigator.pop(ctx, v.trim()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Crear'),
          ),
        ],
      ),
    );
    if (!mounted || name == null || name.isEmpty) return;
    try {
      await _vault!.createFolder(name);
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }

  Future<void> _showNoteContextMenu(VaultNode node) async {
    if (_vault == null) return;
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: Icon(_favorites.contains(node.relPath) ? Icons.star_outline : Icons.star_rounded),
              title: Text(_favorites.contains(node.relPath) ? 'Quitar de favoritos' : 'Marcar favorita'),
              onTap: () => Navigator.pop(ctx, 'favorite'),
            ),
            ListTile(
              leading: const Icon(Icons.edit_outlined),
              title: const Text('Renombrar'),
              onTap: () => Navigator.pop(ctx, 'rename'),
            ),
            ListTile(
              leading: const Icon(Icons.drive_file_move_outlined),
              title: const Text('Mover a…'),
              onTap: () => Navigator.pop(ctx, 'move'),
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline, color: Colors.red),
              title: const Text('Eliminar', style: TextStyle(color: Colors.red)),
              onTap: () => Navigator.pop(ctx, 'delete'),
            ),
          ],
        ),
      ),
    );
    if (!mounted || action == null) return;
    if (action == 'favorite') {
      setState(() {
        if (_favorites.contains(node.relPath)) {
          _favorites.remove(node.relPath);
        } else {
          _favorites.add(node.relPath);
        }
      });
    }
    if (action == 'rename') await _renameNote(node);
    if (action == 'move') await _moveNote(node);
    if (action == 'delete') await _deleteNote(node);
  }

  Future<void> _renameNote(VaultNode node) async {
    if (_vault == null) return;
    final controller = TextEditingController(text: node.name.replaceAll('.md', ''));
    final newName = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Renombrar nota'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Nuevo nombre'),
          onSubmitted: (v) => Navigator.pop(ctx, v.trim()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Renombrar'),
          ),
        ],
      ),
    );
    if (!mounted || newName == null || newName.isEmpty) return;
    try {
      await _vault!.renameNote(p.join(_vault!.vaultPath, node.relPath), newName);
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }

  Future<void> _moveNote(VaultNode node) async {
    if (_vault == null) return;
    final folders = await _listFolders();
    if (!mounted) return;
    if (folders.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No hay carpetas en el vault')),
      );
      return;
    }
    final dest = await showDialog<String>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Mover a…'),
        children: folders
            .map((f) => SimpleDialogOption(
                  onPressed: () => Navigator.pop(ctx, f),
                  child: Text(f.isEmpty ? 'Raíz' : f),
                ))
            .toList(),
      ),
    );
    if (!mounted || dest == null) return;
    try {
      final absSrc = p.join(_vault!.vaultPath, node.relPath);
      final absDest = p.join(_vault!.vaultPath, dest, node.name);
      await _vault!.moveNote(absSrc, absDest);
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }

  Future<List<String>> _listFolders() async {
    if (_vault == null) return [];
    final folders = <String>[''];
    final root = Directory(_vault!.vaultPath);
    await for (final entity in root.list(recursive: true, followLinks: false)) {
      if (entity is Directory) {
        final rel = p.relative(entity.path, from: _vault!.vaultPath);
        if (rel != '.' && !rel.startsWith('.') && !rel.contains('attachments')) {
          folders.add(rel);
        }
      }
    }
    return folders;
  }

  Future<void> _deleteNote(VaultNode node) async {
    if (_vault == null) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('¿Eliminar nota?'),
        content: Text('"${node.name}" se eliminará permanentemente.'),
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
    if (ok != true || !mounted) return;
    try {
      await _vault!.deleteNote(p.join(_vault!.vaultPath, node.relPath));
      if (_selectedRelPath == node.relPath) {
        setState(() { _selectedRelPath = null; });
      }
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }

  Future<void> _renameFolder(VaultNode node) async {
    if (_vault == null) return;
    final controller = TextEditingController(text: node.name);
    final newName = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Renombrar carpeta'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Nuevo nombre'),
          onSubmitted: (v) => Navigator.pop(ctx, v.trim()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Renombrar'),
          ),
        ],
      ),
    );
    if (!mounted || newName == null || newName.isEmpty || newName == node.name) return;
    try {
      final parent = p.dirname(node.relPath);
      final newRel = parent == '.' ? newName : p.join(parent, newName);
      await _vault!.moveNote(
        p.join(_vault!.vaultPath, node.relPath),
        p.join(_vault!.vaultPath, newRel),
      );
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }

  Future<void> _deleteFolder(VaultNode node) async {
    if (_vault == null) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('¿Eliminar carpeta?'),
        content: Text('"${node.name}" y todo su contenido se eliminarán.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Eliminar todo'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await _vault!.deleteFolder(p.join(_vault!.vaultPath, node.relPath), recursive: true);
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }

  bool _matchesFilter(VaultNode n) {
    if (!_filter.isNotEmpty) return true;
    if (n.name.toLowerCase().contains(_filter)) return true;
    return n.children.any(_matchesFilter);
  }

  /// Resuelve la fecha de modificación del nodo. Hace `stat` rápido.
  DateTime _modifiedOf(VaultNode n) {
    if (n.note?.modified != null) return n.note!.modified;
    try {
      final f = File(p.join(_vault!.vaultPath, n.relPath));
      if (f.existsSync()) return f.statSync().modified;
    } catch (_) {}
    return DateTime.fromMillisecondsSinceEpoch(0);
  }

  /// Recolecta tags de los nombres de archivo (heurística rápida).
  /// Para tag real haría falta leer frontmatter; lo hacemos async opcional.
  List<String> _collectTags() {
    final tags = <String>{};
    void walk(VaultNode n) {
      if (!n.isDir) {
        final base = n.name.replaceAll('.md', '');
        for (final word in base.split(RegExp(r'[\s_\-\.]'))) {
          if (word.length >= 3 && word.toLowerCase() != word.toUpperCase()) {
            tags.add(word);
          }
        }
      } else {
        for (final c in n.children) walk(c);
      }
    }
    walk(_tree!);
    final list = tags.toList()..sort();
    return list;
  }

  Future<void> _showImportDialog() async {
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Importar a vault',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
            ),
            ListTile(
              leading: const Icon(Icons.style, color: Color(0xFF1976D2)),
              title: const Text('Anki (.apkg)'),
              subtitle: const Text('Importa un mazo Anki con todas sus cards y tags'),
              onTap: () => Navigator.pop(ctx, 'apkg'),
            ),
            ListTile(
              leading: const Icon(Icons.picture_as_pdf, color: Color(0xFFD32F2F)),
              title: const Text('PDF (.pdf)'),
              subtitle: const Text('Convierte un PDF en notas markdown'),
              onTap: () => Navigator.pop(ctx, 'pdf'),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (!mounted || action == null) return;
    if (action == 'apkg' || action == 'pdf') {
      _launchImportFlow(action);
    }
  }

  Future<void> _launchImportFlow(String format) async {
    if (_vault == null) return;
    final ext = format == 'apkg' ? 'apkg' : 'pdf';
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: [ext],
        allowMultiple: false,
        withData: false,
      );
      if (result == null || result.files.isEmpty) return;
      final sourcePath = result.files.first.path;
      if (sourcePath == null) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No se pudo obtener el path')),
        );
        return;
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Importando ${p.basename(sourcePath)}...')),
      );
      final importedDir = Directory(p.join(_vault!.vaultPath, 'Imported'));
      if (!await importedDir.exists()) await importedDir.create(recursive: true);
      final destPath = p.join(importedDir.path, p.basename(sourcePath));
      await File(sourcePath).copy(destPath);
      if (!mounted) return;
      showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Archivo copiado'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Origen: ${p.basename(sourcePath)}'),
              const SizedBox(height: 4),
              Text('Destino: vault/Imported/'),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () {
                Clipboard.setData(ClipboardData(text: destPath));
                Navigator.pop(ctx);
              },
              child: const Text('Copiar path'),
            ),
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cerrar')),
          ],
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }
}

// ── SUBCOMPONENTES ───────────────────────────────────────────────────

class _ScopeChip extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;
  const _ScopeChip({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(MxRadius.pill),
      child: AnimatedContainer(
        duration: MxMotion.fast,
        curve: MxMotion.standard,
        padding: const EdgeInsets.symmetric(horizontal: MxSpacing.md, vertical: MxSpacing.sm),
        decoration: BoxDecoration(
          color: selected
              ? MxColors.indigoDeep.withOpacity(0.15)
              : Theme.of(context).colorScheme.surfaceContainerHighest.withOpacity(0.5),
          borderRadius: BorderRadius.circular(MxRadius.pill),
          border: Border.all(
            color: selected
                ? MxColors.indigoDeep.withOpacity(0.4)
                : Theme.of(context).dividerColor.withOpacity(0.3),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 14,
              color: selected ? MxColors.indigoSoft : Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                color: selected ? MxColors.indigoSoft : null,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _VaultItemRow extends StatelessWidget {
  final VaultNode node;
  final VaultService vault;
  final bool selected;
  final bool isFavorite;
  final VoidCallback onTap;
  final VoidCallback onLongPress;
  final VoidCallback onToggleFavorite;
  const _VaultItemRow({
    required this.node,
    required this.vault,
    required this.selected,
    required this.isFavorite,
    required this.onTap,
    required this.onLongPress,
    required this.onToggleFavorite,
  });

  String _folderLabel() {
    final parts = node.relPath.split('/');
    if (parts.length <= 1) return 'Raíz';
    parts.removeLast();
    return parts.join(' / ');
  }

  String _dateLabel() {
    // v0.62.11: el vault no llama initializeDateFormatting('es_ES') al
    // arranque (home_screen.dart tiene su propio formateador manual por
    // la misma razón). Formateamos sin intl para evitar el fallback a
    // "1 ene" / "1 Jan" raro que sale cuando locale no está inicializado.
    final now = DateTime.now();
    final d = node.note?.modified ?? DateTime.fromMillisecondsSinceEpoch(0);
    final diff = now.difference(d);
    if (diff.inMinutes < 1) return 'ahora';
    if (diff.inMinutes < 60) return 'hace ${diff.inMinutes} min';
    if (diff.inHours < 24) return 'hace ${diff.inHours} h';
    if (diff.inDays < 7) return 'hace ${diff.inDays} d';
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return '${d.day} ${months[d.month - 1]}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final title = node.name.replaceAll('.md', '');

    return InkWell(
      onTap: onTap,
      onLongPress: onLongPress,
      borderRadius: BorderRadius.circular(MxRadius.lg),
      child: AnimatedContainer(
        duration: MxMotion.fast,
        curve: MxMotion.standard,
        padding: const EdgeInsets.all(MxSpacing.md),
        decoration: BoxDecoration(
          color: selected
              ? MxColors.indigoDeep.withOpacity(0.10)
              : scheme.surfaceContainerLow.withOpacity(0.4),
          borderRadius: BorderRadius.circular(MxRadius.lg),
          border: Border.all(
            color: selected
                ? MxColors.indigoDeep.withOpacity(0.35)
                : scheme.outlineVariant.withOpacity(0.3),
            width: 1,
          ),
        ),
        child: Row(
          children: [
            // Icon badge
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    MxColors.indigoDeep.withOpacity(0.15),
                    MxColors.violet.withOpacity(0.10),
                  ],
                ),
                borderRadius: BorderRadius.circular(MxRadius.md),
              ),
              alignment: Alignment.center,
              child: const Icon(
                Icons.description_rounded,
                size: 20,
                color: MxColors.indigoSoft,
              ),
            ),
            const SizedBox(width: MxSpacing.md),
            // Title + meta
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          title,
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w600,
                            letterSpacing: -0.2,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (isFavorite) ...[
                        const SizedBox(width: 4),
                        const Icon(Icons.star_rounded, size: 14, color: Color(0xFFFBBF24)),
                      ],
                    ],
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Icon(
                        Icons.folder_outlined,
                        size: 11,
                        color: scheme.onSurfaceVariant,
                      ),
                      const SizedBox(width: 3),
                      Flexible(
                        child: Text(
                          _folderLabel(),
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: scheme.onSurfaceVariant,
                            fontSize: 11,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        width: 3, height: 3,
                        decoration: BoxDecoration(
                          color: scheme.onSurfaceVariant.withOpacity(0.4),
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Icon(
                        Icons.schedule_rounded,
                        size: 11,
                        color: scheme.onSurfaceVariant,
                      ),
                      const SizedBox(width: 3),
                      Text(
                        _dateLabel(),
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            // Trailing: star + chevron
            IconButton(
              icon: Icon(
                isFavorite ? Icons.star_rounded : Icons.star_outline_rounded,
                size: 18,
                color: isFavorite ? const Color(0xFFFBBF24) : scheme.onSurfaceVariant,
              ),
              onPressed: onToggleFavorite,
              tooltip: isFavorite ? 'Quitar de favoritas' : 'Marcar favorita',
              visualDensity: VisualDensity.compact,
            ),
            Icon(
              Icons.chevron_right_rounded,
              size: 18,
              color: scheme.onSurfaceVariant,
            ),
          ],
        ),
      ),
    );
  }
}
