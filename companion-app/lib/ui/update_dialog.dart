// UpdateDialog: muestra al usuario que hay una nueva versión disponible
// con el changelog y los botones de acción.
//
// Uso:
//   showDialog(context: ctx, builder: (_) => UpdateDialog(update: update, ...))
//
// v0.30: implementado con download + install via platform channel.

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import '../services/updater.dart';

class UpdateDialog extends StatefulWidget {
  final AppUpdate update;
  final String installedVersion;
  final Updater updater;
  final VoidCallback? onDismiss;
  final bool autoDownload;       // si true, descarga e instala al abrir

  const UpdateDialog({
    super.key,
    required this.update,
    required this.installedVersion,
    required this.updater,
    this.onDismiss,
    this.autoDownload = false,
  });

  @override
  State<UpdateDialog> createState() => _UpdateDialogState();
}

class _UpdateDialogState extends State<UpdateDialog> {
  String? _downloadedPath;
  String? _error;
  bool _downloading = false;
  double _progress = 0;

  @override
  void initState() {
    super.initState();
    widget.updater.addListener(_onUpdaterChange);
    if (widget.autoDownload) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _downloadAndInstall());
    }
  }

  @override
  void dispose() {
    widget.updater.removeListener(_onUpdaterChange);
    super.dispose();
  }

  void _onUpdaterChange() {
    if (!mounted) return;
    setState(() {
      _downloading = widget.updater.isDownloading;
      _progress = widget.updater.downloadProgress;
    });
  }

  Future<void> _downloadAndInstall() async {
    setState(() {
      _downloading = true;
      _error = null;
    });
    final file = await widget.updater.downloadApk(widget.update);
    if (!mounted) return;
    if (file == null) {
      setState(() {
        _downloading = false;
        _error = 'No se pudo descargar el APK. Revisa tu conexión.';
      });
      return;
    }
    setState(() {
      _downloading = false;
      _downloadedPath = file.path;
    });
    // Intentar instalar
    final ok = await widget.updater.installApk(file);
    if (!mounted) return;
    if (!ok) {
      setState(() {
        _error = Platform.isAndroid
            ? 'No se pudo abrir el instalador. Verifica que "Instalar apps de origen desconocido" esté habilitado para M-NEXUS.'
            : 'La instalación automática solo está disponible en Android.';
      });
    }
  }

  void _openReleasePage() {
    // Abre la página de GitHub Releases en el navegador del sistema
    // (siempre funciona, incluso si el platform channel falla)
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Descarga manual'),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Abre este enlace en tu navegador para descargar:'),
              const SizedBox(height: 12),
              SelectableText(
                widget.update.apkDownloadUrl,
                style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
              ),
              const SizedBox(height: 12),
              const Text(
                '1. Descarga el APK\n'
                '2. Abre el archivo descargado\n'
                '3. Android lo instalará encima de la versión actual\n'
                '4. Tus datos y configuración se conservan',
                style: TextStyle(fontSize: 12),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cerrar'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final sizeStr = widget.update.apkSize > 0
        ? '${(widget.update.apkSize / 1024 / 1024).toStringAsFixed(1)} MB'
        : '';
    final dateStr = widget.update.publishedAt.year > 1971
        ? '${widget.update.publishedAt.day}/${widget.update.publishedAt.month}/${widget.update.publishedAt.year}'
        : '';

    return AlertDialog(
      title: Row(
        children: [
          Icon(Icons.system_update, color: theme.colorScheme.primary),
          const SizedBox(width: 12),
          const Expanded(child: Text('Nueva versión disponible')),
        ],
      ),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 400, maxHeight: 500),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            // Versión
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: theme.colorScheme.primaryContainer.withOpacity(0.3),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('v${widget.installedVersion}',
                          style: theme.textTheme.bodySmall),
                      Text('v${widget.update.latestVersion}',
                          style: theme.textTheme.titleLarge?.copyWith(
                            color: theme.colorScheme.primary,
                            fontWeight: FontWeight.bold,
                          )),
                    ],
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      if (sizeStr.isNotEmpty)
                        Text(sizeStr, style: theme.textTheme.bodySmall),
                      if (dateStr.isNotEmpty)
                        Text(dateStr, style: theme.textTheme.bodySmall),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),

            // Changelog
            if (widget.update.body.isNotEmpty) ...[
              Text('Cambios:', style: theme.textTheme.titleSmall),
              const SizedBox(height: 4),
              Flexible(
                child: Markdown(
                  data: widget.update.body,
                  shrinkWrap: true,
                  styleSheet: MarkdownStyleSheet.fromTheme(theme).copyWith(
                    p: theme.textTheme.bodySmall,
                    listBullet: theme.textTheme.bodySmall,
                  ),
                ),
              ),
            ],
            const SizedBox(height: 8),

            // Progreso de descarga
            if (_downloading) ...[
              const SizedBox(height: 8),
              LinearProgressIndicator(value: _progress > 0 ? _progress : null),
              const SizedBox(height: 4),
              Text(
                _progress > 0
                    ? 'Descargando... ${(_progress * 100).toStringAsFixed(0)}%'
                    : 'Descargando...',
                style: theme.textTheme.bodySmall,
              ),
            ],

            // Error
            if (_error != null) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: theme.colorScheme.errorContainer.withOpacity(0.5),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Row(
                  children: [
                    Icon(Icons.warning_amber, color: theme.colorScheme.error, size: 18),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(_error!, style: theme.textTheme.bodySmall),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _downloading ? null : widget.onDismiss ?? () => Navigator.of(context).pop(),
          child: const Text('Más tarde'),
        ),
        if (_downloadedPath == null)
          FilledButton.icon(
            onPressed: _downloading ? null : _downloadAndInstall,
            icon: const Icon(Icons.download),
            label: const Text('Descargar e instalar'),
          )
        else
          FilledButton.icon(
            onPressed: _openReleasePage,
            icon: const Icon(Icons.info_outline),
            label: const Text('Ver descarga'),
          ),
      ],
    );
  }
}
