// UpdateDialog: muestra al usuario que hay una nueva versión disponible
// con el changelog y los botones de acción.
//
// v0.34 (revisión):
//   - Mejor manejo de errores (mostrar el código exacto)
//   - Hint sobre permisos de instalación
//   - Stepper visual (descargando → instalando → listo)
//   - Reintento de instalación si el platform channel falla

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import '../services/updater.dart';

class UpdateDialog extends StatefulWidget {
  final AppUpdate update;
  final String installedVersion;
  final Updater updater;
  final VoidCallback? onDismiss;
  final bool autoDownload;

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

enum _InstallStep { idle, downloading, downloaded, installing, installed, failed }

class _UpdateDialogState extends State<UpdateDialog> {
  String? _downloadedPath;
  String? _error;
  _InstallStep _step = _InstallStep.idle;
  double _progress = 0;
  String? _errorCode;

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
      _progress = widget.updater.downloadProgress;
    });
  }

  Future<void> _downloadAndInstall() async {
    setState(() {
      _step = _InstallStep.downloading;
      _error = null;
      _errorCode = null;
    });
    final file = await widget.updater.downloadApk(widget.update);
    if (!mounted) return;
    if (file == null) {
      setState(() {
        _step = _InstallStep.failed;
        _error = 'No se pudo descargar el APK. Revisa tu conexión o intenta más tarde.';
        _errorCode = 'DOWNLOAD_FAILED';
      });
      return;
    }
    setState(() {
      _downloadedPath = file.path;
      _step = _InstallStep.downloaded;
    });
    // Intentar instalar
    await _installDownloaded();
  }

  Future<void> _installDownloaded() async {
    if (_downloadedPath == null) return;
    setState(() {
      _step = _InstallStep.installing;
      _error = null;
    });
    final ok = await widget.updater.installApk(File(_downloadedPath!));
    if (!mounted) return;
    if (ok) {
      setState(() {
        _step = _InstallStep.installed;
      });
    } else {
      // Diagnóstico: qué falta?
      String hint = 'No se pudo abrir el instalador.';
      String code = 'INSTALL_INVOKE_FAILED';
      // Comprobar si el permiso de instalar está concedido
      try {
        final granted = await _isInstallPermissionGranted();
        if (!granted) {
          hint = 'Activa "Instalar apps de origen desconocido" para M-NEXUS en Settings → Apps → M-NEXUS → Instalar apps desconocidas.';
          code = 'INSTALL_PERMISSION_DENIED';
        }
      } catch (_) {}
      setState(() {
        _step = _InstallStep.failed;
        _error = hint;
        _errorCode = code;
      });
    }
  }

  Future<bool> _isInstallPermissionGranted() async {
    // El platform channel "com.mnexus.installer/permissions" puede consultar esto
    try {
      const channel = MethodChannel('com.mnexus.installer/permissions');
      return await channel.invokeMethod<bool>('isInstallPermissionGranted') ?? true;
    } catch (_) {
      return true;
    }
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
                      Text('v${widget.installedVersion}', style: theme.textTheme.bodySmall),
                      Text('v${widget.update.latestVersion}',
                        style: theme.textTheme.titleLarge?.copyWith(
                          color: theme.colorScheme.primary,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      if (sizeStr.isNotEmpty) Text(sizeStr, style: theme.textTheme.bodySmall),
                      if (dateStr.isNotEmpty) Text(dateStr, style: theme.textTheme.bodySmall),
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

            // Stepper visual
            _buildStepper(),

            // Error
            if (_error != null) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: theme.colorScheme.errorContainer.withOpacity(0.5),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.warning_amber, color: theme.colorScheme.error, size: 18),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(_error!,
                            style: theme.textTheme.bodySmall,
                          ),
                        ),
                      ],
                    ),
                    if (_errorCode != null) ...[
                      const SizedBox(height: 4),
                      Text('Código: $_errorCode',
                        style: theme.textTheme.bodySmall?.copyWith(
                          fontFamily: 'monospace',
                          color: theme.colorScheme.onErrorContainer,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _step == _InstallStep.downloading || _step == _InstallStep.installing
              ? null
              : (widget.onDismiss ?? () => Navigator.of(context).pop()),
          child: const Text('Más tarde'),
        ),
        if (_step == _InstallStep.failed)
          FilledButton.icon(
            onPressed: _installDownloaded,
            icon: const Icon(Icons.refresh),
            label: const Text('Reintentar'),
          )
        else if (_step == _InstallStep.downloaded)
          FilledButton.icon(
            onPressed: _installDownloaded,
            icon: const Icon(Icons.install_mobile),
            label: const Text('Instalar'),
          )
        else if (_step == _InstallStep.installed)
          FilledButton.icon(
            onPressed: () => Navigator.of(context).pop(),
            icon: const Icon(Icons.check),
            label: const Text('Listo'),
          )
        else
          FilledButton.icon(
            onPressed: _step == _InstallStep.downloading ? null : _downloadAndInstall,
            icon: const Icon(Icons.download),
            label: const Text('Descargar e instalar'),
          ),
      ],
    );
  }

  Widget _buildStepper() {
    Widget step(String label, bool active, bool done) {
      return Row(
        children: [
          Container(
            width: 24, height: 24,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: done ? Colors.green : (active ? Colors.blue : Colors.grey.shade300),
            ),
            child: Icon(
              done ? Icons.check : Icons.circle,
              size: 14,
              color: Colors.white,
            ),
          ),
          const SizedBox(width: 8),
          Text(label,
            style: TextStyle(
              fontWeight: active ? FontWeight.bold : FontWeight.normal,
              color: done || active ? Colors.black87 : Colors.grey,
            ),
          ),
        ],
      );
    }

    return Column(
      children: [
        step('Descargar',
          _step == _InstallStep.downloading,
          _step == _InstallStep.downloaded || _step == _InstallStep.installing || _step == _InstallStep.installed,
        ),
        if (_step == _InstallStep.downloading) ...[
          const SizedBox(height: 4),
          LinearProgressIndicator(value: _progress > 0 ? _progress : null),
        ],
        const SizedBox(height: 6),
        step('Instalar',
          _step == _InstallStep.installing,
          _step == _InstallStep.installed,
        ),
      ],
    );
  }
}
