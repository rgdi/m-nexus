// settings_screen.dart — RemNote-style minimal.
//
// v0.62.12: filosofía RemNote.
//   - Sin secciones tipo card. Una sola lista plana.
//   - Subtítulos pequeños (10-11sp) en gris para agrupar visualmente.
//   - Búsqueda arriba (filtra items por título).
//   - Items agrupados: General / Apariencia / Vault / Sync / About.
//   - Tap = acción directa o navegar a sub-screen.
//   - Sin cards pesadas, sin gradientes, sin expansiones.

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/design_tokens.dart';
import '../../core/theme.dart';
import '../../services/settings_service.dart';
import '../../services/vault_detector.dart';
import '../../state/app_state.dart';
import '../help/help_screen.dart';
import '../setup/onboarding_tutorial.dart';
import '../subjects/subjects_screen.dart';
import 'ai_settings_screen.dart';
import 'sync_dashboard_screen.dart';
import 'logs_screen.dart';
import 'changelog_view.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});
  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _settings = SettingsService.instance;
  final _searchCtrl = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  // ── HELPERS ─────────────────────────────────────────────────────────

  void _showSnack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), duration: const Duration(seconds: 3)),
    );
  }

  Future<void> _showThemePicker() async {
    final m = await showModalBottomSheet<AppThemeMode>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final mode in AppThemeMode.values)
              ListTile(
                title: Text(_themeLabel(mode)),
                trailing: _settings.current.themeMode == mode
                    ? const Icon(Icons.check_rounded, size: 18)
                    : null,
                onTap: () => Navigator.pop(ctx, mode),
              ),
          ],
        ),
      ),
    );
    if (m != null) {
      await _settings.update(themeMode: m);
      setState(() {});
    }
  }

  Future<void> _showFontPicker() async {
    final s = await showModalBottomSheet<double>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final v in const [0.85, 0.95, 1.0, 1.1, 1.2, 1.3])
              ListTile(
                title: Text('${(v * 100).toStringAsFixed(0)}%'),
                trailing: _settings.current.fontScale == v
                    ? const Icon(Icons.check_rounded, size: 18)
                    : null,
                onTap: () => Navigator.pop(ctx, v),
              ),
          ],
        ),
      ),
    );
    if (s != null) {
      await _settings.update(fontScale: s);
      setState(() {});
    }
  }

  Future<void> _toggleHaptics(bool v) async {
    await _settings.update(enableHaptics: v);
    setState(() {});
  }

  Future<void> _showVaultsDialog() async {
    final detector = VaultDetector();
    final vaults = await detector.detectVaults();
    if (!mounted) return;
    if (vaults.isEmpty) {
      _showSnack('No se detectaron vaults. Configurá uno manualmente.');
      return;
    }
    await showDialog(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Vaults detectados'),
        children: vaults
            .map((v) => SimpleDialogOption(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(v.name,
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                      Text(v.path,
                          style: const TextStyle(fontSize: 11, color: Colors.grey)),
                    ],
                  ),
                  onPressed: () => Navigator.pop(ctx),
                ))
            .toList(),
      ),
    );
  }

  Future<void> _showBackendDialog() async {
    final ctrl = TextEditingController(text: _settings.current.backendUrl ?? '');
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('URL del Backend'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'http://192.168.1.83:4100',
            labelText: 'Backend URL',
          ),
          keyboardType: TextInputType.url,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          TextButton(
            onPressed: () async {
              await _settings.update(clearBackend: true);
              if (mounted) Navigator.pop(ctx);
            },
            child: const Text('Borrar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
            child: const Text('Guardar'),
          ),
        ],
      ),
    );
    if (result != null) {
      await _settings.update(backendUrl: result.isEmpty ? null : result);
      if (mounted) setState(() {});
    }
  }

  Future<void> _showCalendarPicker() async {
    // El CalendarPicker real está embebido en otra screen; por simplicidad
    // mostramos un snack indicando el path actual.
    _showSnack('Calendario del sistema activo');
  }

  // ── BUILD ────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    // Items agrupados.
    final groups = _buildGroups();

    return Scaffold(
      body: SafeArea(
        top: true,
        bottom: false,
        child: Column(
          children: [
            _buildHeader(theme, scheme),
            _buildSearch(theme, scheme),
            const Divider(height: 1),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(bottom: MxSpacing.xxxl),
                children: _renderGroups(groups, theme, scheme),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader(ThemeData theme, ColorScheme scheme) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          MxSpacing.xl, MxSpacing.md, MxSpacing.xl, MxSpacing.sm),
      child: Row(
        children: [
          Text(
            'Ajustes',
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w700,
              letterSpacing: -0.4,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSearch(ThemeData theme, ColorScheme scheme) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          MxSpacing.lg, 0, MxSpacing.lg, MxSpacing.sm),
      child: TextField(
        controller: _searchCtrl,
        decoration: InputDecoration(
          hintText: 'Buscar en ajustes…',
          prefixIcon: const Icon(Icons.search_rounded, size: 18),
          suffixIcon: _query.isNotEmpty
              ? IconButton(
                  icon: const Icon(Icons.clear_rounded, size: 18),
                  onPressed: () {
                    _searchCtrl.clear();
                    setState(() => _query = '');
                  },
                )
              : null,
          isDense: true,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(MxRadius.md),
          ),
        ),
        onChanged: (v) => setState(() => _query = v.toLowerCase()),
      ),
    );
  }

  List<_Group> _buildGroups() {
    final all = <_Group>[
      _Group('General', [
        _Item(
          icon: Icons.folder_outlined,
          title: 'Vaults',
          subtitle: 'Detectar vault activo',
          onTap: _showVaultsDialog,
        ),
        _Item(
          icon: Icons.account_tree_outlined,
          title: 'Asignaturas',
          subtitle: 'Materias y colores',
          onTap: () {
            final app = AppState.instance;
            final vp = app.activeVault?.path;
            if (vp == null) {
              _showSnack('Sin vault activo');
              return;
            }
            Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => SubjectsScreen(vaultPath: vp)),
            );
          },
        ),
        if (!kIsWeb)
          _Item(
            icon: Icons.calendar_today_outlined,
            title: 'Calendario',
            subtitle: 'Seleccionar calendario',
            onTap: _showCalendarPicker,
          ),
      ]),
      _Group('Apariencia', [
        _Item(
          icon: Icons.dark_mode_outlined,
          title: 'Tema',
          subtitle: _themeLabel(_settings.current.themeMode),
          onTap: _showThemePicker,
        ),
        _Item(
          icon: Icons.text_fields_rounded,
          title: 'Tamaño de texto',
          subtitle: '${(_settings.current.fontScale * 100).toStringAsFixed(0)}%',
          onTap: _showFontPicker,
        ),
        _Item(
          icon: Icons.vibration_rounded,
          title: 'Vibración',
          subtitle: _settings.current.enableHaptics ? 'Activada' : 'Desactivada',
          trailing: Switch(
            value: _settings.current.enableHaptics,
            onChanged: _toggleHaptics,
          ),
        ),
      ]),
      _Group('Sync', [
        _Item(
          icon: Icons.cloud_outlined,
          title: 'Backend',
          subtitle: _settings.current.backendUrl ?? 'No configurado',
          onTap: _showBackendDialog,
        ),
        _Item(
          icon: Icons.dashboard_outlined,
          title: 'Sync dashboard',
          subtitle: 'Estado y logs de sincronización',
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const SyncDashboardScreen()),
          ),
        ),
        _Item(
          icon: Icons.smart_toy_outlined,
          title: 'IA',
          subtitle: 'Tutor, embeddings, modelos',
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const AiSettingsScreen()),
          ),
        ),
        _Item(
          icon: Icons.bug_report_outlined,
          title: 'Logs',
          subtitle: 'Diagnóstico',
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const LogsScreen()),
          ),
        ),
      ]),
      _Group('Ayuda', [
        _Item(
          icon: Icons.help_outline_rounded,
          title: 'Tutorial',
          subtitle: 'Repasar el onboarding',
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => OnboardingTutorial(onFinish: () {})),
          ),
        ),
        _Item(
          icon: Icons.menu_book_outlined,
          title: 'Documentación',
          subtitle: 'github.com/rgdi/m-nexus',
          onTap: () => _showSnack('Abrí el link en tu navegador'),
        ),
        _Item(
          icon: Icons.history_rounded,
          title: 'Changelog',
          subtitle: 'Versiones',
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const ChangelogView()),
          ),
        ),
      ]),
    ];

    if (_query.isEmpty) return all;
    final filtered = <_Group>[];
    for (final g in all) {
      final items = g.items
          .where((i) =>
              i.title.toLowerCase().contains(_query) ||
              (i.subtitle?.toLowerCase().contains(_query) ?? false))
          .toList();
      if (items.isNotEmpty) {
        filtered.add(_Group(g.title, items));
      }
    }
    return filtered;
  }

  List<Widget> _renderGroups(List<_Group> groups, ThemeData theme, ColorScheme scheme) {
    if (groups.isEmpty) {
      return [
        Padding(
          padding: const EdgeInsets.all(MxSpacing.xl),
          child: Center(
            child: Text(
              'Sin resultados para "$_query"',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
            ),
          ),
        ),
      ];
    }
    final out = <Widget>[];
    for (final g in groups) {
      out.add(_GroupHeader(label: g.title));
      for (final it in g.items) {
        out.add(_SettingTile(item: it));
      }
    }
    return out;
  }

  String _themeLabel(AppThemeMode m) {
    switch (m) {
      case AppThemeMode.light: return 'Claro';
      case AppThemeMode.dark: return 'Oscuro';
      case AppThemeMode.system: return 'Sistema';
    }
  }
}

// ── WIDGETS ───────────────────────────────────────────────────────────

class _Group {
  final String title;
  final List<_Item> items;
  _Group(this.title, this.items);
}

class _Item {
  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  _Item({
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
  });
}

class _GroupHeader extends StatelessWidget {
  final String label;
  const _GroupHeader({required this.label});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          MxSpacing.xl, MxSpacing.lg, MxSpacing.xl, MxSpacing.xs),
      child: Text(
        label.toUpperCase(),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.8,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
      ),
    );
  }
}

class _SettingTile extends StatelessWidget {
  final _Item item;
  const _SettingTile({required this.item});
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return InkWell(
      onTap: item.trailing != null ? null : item.onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
            horizontal: MxSpacing.xl, vertical: MxSpacing.md),
        child: Row(
          children: [
            Icon(
              item.icon,
              size: 20,
              color: scheme.onSurfaceVariant,
            ),
            const SizedBox(width: MxSpacing.lg),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.title,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  if (item.subtitle != null && item.subtitle!.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      item.subtitle!,
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                        fontSize: 11,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
            if (item.trailing != null)
              item.trailing!
            else
              Icon(
                Icons.chevron_right_rounded,
                size: 18,
                color: scheme.onSurfaceVariant.withOpacity(0.5),
              ),
          ],
        ),
      ),
    );
  }
}
