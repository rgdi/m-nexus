// webview_embed.dart: WebView para embeds in-app (v0.61.2).
//
// Renderiza contenido web dentro de la app sin abrir browser externo.
// Caso de uso: leer articulos, ver videos, navegar links sin salir.

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../../services/logger.dart';

class WebViewEmbed extends StatefulWidget {
  final String url;
  final String? title;
  final bool allowJavaScript;
  final bool allowZoom;
  final double? height;
  const WebViewEmbed({
    super.key,
    required this.url,
    this.title,
    this.allowJavaScript = true,
    this.allowZoom = true,
    this.height,
  });

  @override
  State<WebViewEmbed> createState() => _WebViewEmbedState();
}

class _WebViewEmbedState extends State<WebViewEmbed> {
  late final WebViewController _controller;
  bool _loading = true;
  String? _error;
  int _progress = 0;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(widget.allowJavaScript ? JavaScriptMode.unrestricted : JavaScriptMode.disabled)
      ..setBackgroundColor(Theme.of(context).colorScheme.surface)
      ..enableZoom(widget.allowZoom)
      ..setNavigationDelegate(NavigationDelegate(
        onPageStarted: (url) {
          AdvancedLogger.instance.info('webview', 'page started', context: { 'url': url });
          if (mounted) setState(() { _loading = true; _progress = 0; });
        },
        onProgress: (p) {
          if (mounted) setState(() => _progress = p);
        },
        onPageFinished: (url) {
          AdvancedLogger.instance.info('webview', 'page finished', context: { 'url': url });
          if (mounted) setState(() { _loading = false; _progress = 100; });
        },
        onWebResourceError: (e) {
          AdvancedLogger.instance.warn('webview', 'resource error', context: {
            'url': e.url, 'code': e.errorCode.value, 'desc': e.description,
          });
          if (mounted) setState(() { _error = e.description; _loading = false; });
        },
      ))
      ..loadRequest(Uri.parse(widget.url));
  }

  @override
  Widget build(BuildContext context) {
    final body = _error != null
      ? _buildError()
      : Stack(children: [
          WebViewWidget(controller: _controller),
          if (_loading) LinearProgressIndicator(
            value: _progress > 0 ? _progress / 100.0 : null,
            minHeight: 2,
          ),
        ]);
    if (widget.height != null) {
      return SizedBox(height: widget.height, child: body);
    }
    return Column(children: [
      if (widget.title != null) Container(
        padding: const EdgeInsets.all(8),
        color: Theme.of(context).colorScheme.surfaceContainerHigh,
        child: Row(children: [
          const Icon(Icons.web, size: 18),
          const SizedBox(width: 8),
          Expanded(child: Text(widget.title!, maxLines: 1, overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w600))),
          if (_loading) SizedBox(
            width: 16, height: 16,
            child: CircularProgressIndicator(strokeWidth: 2, value: _progress > 0 ? _progress / 100.0 : null),
          ),
        ]),
      ),
      Expanded(child: body),
    ]);
  }

  Widget _buildError() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, size: 64, color: Colors.red),
          const SizedBox(height: 16),
          Text('Error cargando: ${widget.url}',
            style: const TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text(_error ?? 'Error desconocido', textAlign: TextAlign.center,
            style: TextStyle(color: Colors.grey[600])),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: () {
              setState(() { _error = null; _loading = true; });
              _controller.reload();
            },
            icon: const Icon(Icons.refresh),
            label: const Text('Reintentar'),
          ),
        ],
      ),
    );
  }
}
