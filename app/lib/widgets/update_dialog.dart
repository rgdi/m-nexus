// update_dialog.dart: dialog que aparece cuando hay un update disponible.
//
// v0.47.2: dialog auto-mostrado, no-modal, con boton "Actualizar" y
// "Mas tarde". Se integra con UpdaterService.

import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import '../state/updater_service.dart';

class UpdateBanner extends StatefulWidget {
  const UpdateBanner({super.key});

  @override
  State<UpdateBanner> createState() => _UpdateBannerState();
}

class _UpdateBannerState extends State<UpdateBanner> {
  late UpdaterService _updater;

  @override
  void initState() {
    super.initState();
    _updater = UpdaterService.instance;
    _updater.addListener(_onChange);
  }

  @override
  void dispose() {
    _updater.removeListener(_onChange);
    super.dispose();
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    if (!_updater.shouldShowUpdateBanner) {
      return const SizedBox.shrink();
    }
    final theme = Theme.of(context);
    final update = _updater.lastResult?.update;
    if (update == null) return const SizedBox.shrink();

    return Material(
      color: theme.colorScheme.primaryContainer,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            children: [
              Icon(Icons.system_update, color: theme.colorScheme.primary),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Actualización ${update.latestVersion} disponible',
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (update.notes.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        update.notes.split('\n').first,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              if (_updater.isDownloading) ...[
                SizedBox(
                  width: 80,
                  child: LinearProgressIndicator(value: _updater.downloadProgress),
                ),
                const SizedBox(width: 8),
              ] else ...[
                TextButton(
                  onPressed: () => _updater.dismissUpdate(),
                  child: const Text('Más tarde'),
                ),
                const SizedBox(width: 4),
                FilledButton(
                  onPressed: () => _showInstallDialog(context),
                  child: const Text('Actualizar'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _showInstallDialog(BuildContext context) async {
    final theme = Theme.of(context);
    final result = _updater.lastResult;
    if (result == null) return;
    final update = result.update;
    if (update == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Actualizar a ${update.latestVersion}'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Versión actual: ${result.installedVersion}'),
              const SizedBox(height: 8),
              if (update.notes.isNotEmpty) ...[
                Text('Cambios:', style: theme.textTheme.labelLarge),
                const SizedBox(height: 4),
                Text(update.notes, style: theme.textTheme.bodySmall),
                const SizedBox(height: 12),
              ],
              if (update.apkSize > 0)
                Text(
                  'Tamaño: ${(update.apkSize / 1024 / 1024).toStringAsFixed(1)} MB',
                  style: theme.textTheme.bodySmall,
                ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Más tarde'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Descargar e instalar'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      final ok = await _updater.downloadAndInstall();
      if (mounted && !ok && _updater.downloadError != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: ${_updater.downloadError}')),
        );
      }
    }
  }
}
