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

    // v0.47.31: banner más compacto (56px de alto vs 140px) para que
    // NO cubra los AppBar.actions (IconButton) de los screens debajo.
    // Antes era un banner alto que interceptaba taps del ▶ y + en la
    // flashcards_list.
    return Material(
      color: theme.colorScheme.primaryContainer,
      // v0.47.32: NO GestureDetector wrapper con HitTestBehavior.opaque.
      // v0.47.31 lo tenía para consumir taps en zonas vacías, pero eso
      // BLOQUEABA los taps de los TextButton hijos (GestureDetector con
      // onTap consume el hit antes de propagarlo a los hijos). Por eso
      // "Más tarde" no dismissaba. Ahora el Material sólo recibe los
      // taps que caen en sus hijos, y los hijos los manejan.
      child: SafeArea(
        top: false,
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          child: Row(
            children: [
              Icon(Icons.system_update, size: 16, color: theme.colorScheme.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Actualización ${update.latestVersion}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (_updater.isDownloading) ...[
                SizedBox(
                  width: 60,
                  child: LinearProgressIndicator(
                    value: _updater.downloadProgress,
                    minHeight: 3,
                  ),
                ),
                const SizedBox(width: 8),
              ] else ...[
                TextButton(
                  onPressed: () {
                    debugPrint('UpdateBanner: dismissing v${update.latestVersion}');
                    _updater.dismissUpdate();
                  },
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    minimumSize: const Size(48, 32),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  child: const Text('Más tarde', style: TextStyle(fontSize: 12)),
                ),
                const SizedBox(width: 4),
                FilledButton(
                  onPressed: () {
                    debugPrint('UpdateBanner: showing install dialog v${update.latestVersion}');
                    _showInstallDialog(context);
                  },
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    minimumSize: const Size(48, 32),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  child: const Text('Actualizar', style: TextStyle(fontSize: 12)),
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
