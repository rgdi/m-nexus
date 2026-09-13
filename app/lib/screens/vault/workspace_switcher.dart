// workspace_switcher.dart — switcher entre múltiples vaults/workspaces.
// v0.62.16: AFFiNE permite tener múltiples workspaces abiertos en el dock.
// M-NEXUS detecta múltiples vaults pero no tenía switcher UI.

import 'package:flutter/material.dart';
import '../../core/design_tokens.dart';
import '../../services/vault_detector.dart';
import '../../services/vault_service.dart';
import '../../widgets/empty_state.dart';
import '../../state/app_state.dart';
import 'trash_screen.dart';
import 'smart_folders_screen.dart';
import '../sync/sync_screen.dart';

class WorkspaceSwitcherScreen extends StatefulWidget {
  final String currentVaultPath;
  const WorkspaceSwitcherScreen({super.key, required this.currentVaultPath});
  @override
  State<WorkspaceSwitcherScreen> createState() => _WorkspaceSwitcherScreenState();
}

class _WorkspaceSwitcherScreenState extends State<WorkspaceSwitcherScreen> {
  final _detector = VaultDetector();
  List<VaultInfo> _vaults = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    _vaults = await _detector.detectVaults();
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _switch(VaultInfo vault) async {
    // Actualiza AppState con nuevo vault activo y pop.
    final app = AppState.instance;
    await app.setVault(vault);
    if (!mounted) return;
    Navigator.of(context).pop(vault.path);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(message: 'Buscando vaults…');
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Workspaces', style: TextStyle(fontWeight: FontWeight.w700)),
      ),
      body: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(MxSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Activos (${_vaults.length})',
                  style: theme.textTheme.labelLarge?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                    fontWeight: FontWeight.w700,
                  )),
                const SizedBox(height: MxSpacing.sm),
                ..._vaults.map((v) => Padding(
                  padding: const EdgeInsets.only(bottom: MxSpacing.xs),
                  child: _WorkspaceRow(
                    vault: v,
                    isCurrent: v.path == widget.currentVaultPath,
                    onSwitch: () => _switch(v),
                  ),
                )),
                if (_vaults.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(MxSpacing.md),
                    child: Text('No hay vaults detectados.'),
                  ),
              ],
            ),
          ),
          const Divider(),
          // Acciones globales
          ListTile(
            leading: const Icon(Icons.filter_alt_outlined),
            title: const Text('Smart Folders'),
            subtitle: const Text('Consultas guardadas del vault'),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => SmartFoldersScreen(vaultPath: widget.currentVaultPath)),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.delete_outline_rounded),
            title: const Text('Papelera'),
            subtitle: const Text('Notas borradas (recuperables)'),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => TrashScreen(vaultPath: widget.currentVaultPath)),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.cloud_sync_outlined),
            title: const Text('Sync entre devices'),
            subtitle: const Text('Pull/Push de notas vía backend'),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => SyncScreen(vaultPath: widget.currentVaultPath)),
            ),
          ),
        ],
      ),
    );
  }
}

class _WorkspaceRow extends StatelessWidget {
  final VaultInfo vault;
  final bool isCurrent;
  final VoidCallback onSwitch;
  const _WorkspaceRow({
    required this.vault,
    required this.isCurrent,
    required this.onSwitch,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: isCurrent ? null : onSwitch,
      borderRadius: BorderRadius.circular(MxRadius.md),
      child: Container(
        padding: const EdgeInsets.all(MxSpacing.md),
        decoration: BoxDecoration(
          color: isCurrent
              ? MxColors.indigoDeep.withOpacity(0.12)
              : theme.colorScheme.surfaceContainerLow.withOpacity(0.4),
          borderRadius: BorderRadius.circular(MxRadius.md),
          border: Border.all(
            color: isCurrent ? MxColors.indigoDeep.withOpacity(0.4) : theme.dividerColor.withOpacity(0.2),
            width: isCurrent ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 36, height: 36,
              decoration: BoxDecoration(
                gradient: const LinearGradient(colors: [Color(0xFF5B5BD6), Color(0xFF8B5CF6)]),
                borderRadius: BorderRadius.circular(MxRadius.sm),
              ),
              alignment: Alignment.center,
              child: const Icon(Icons.folder_rounded, size: 18, color: Colors.white),
            ),
            const SizedBox(width: MxSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(vault.name,
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                  Text(vault.path,
                    maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                ],
              ),
            ),
            if (isCurrent)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: MxColors.indigoDeep,
                  borderRadius: BorderRadius.circular(MxRadius.pill),
                ),
                child: const Text('ACTIVO', style: TextStyle(fontSize: 10, color: Colors.white, fontWeight: FontWeight.w800)),
              )
            else
              const Icon(Icons.swap_horiz_rounded, size: 18),
          ],
        ),
      ),
    );
  }
}
