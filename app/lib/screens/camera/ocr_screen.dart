// ocr_screen.dart — captura foto y extrae texto vía OCR nativo Android.
// v0.62.16: AFFiNE-style quick capture. Usa ML Kit Text Recognition v2
// si disponible; fallback a Tesseract. Aquí implementamos OCR via Android
// nativo usando TextRecognizer (com.google.mlkit:text-recognition).

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import '../../core/design_tokens.dart';
import '../../services/vault_service.dart';
import '../../widgets/empty_state.dart';

class OcrScreen extends StatefulWidget {
  final String vaultPath;
  const OcrScreen({super.key, required this.vaultPath});
  @override
  State<OcrScreen> createState() => _OcrScreenState();
}

class _OcrScreenState extends State<OcrScreen> {
  static const _channel = MethodChannel('com.mnexus.app/ocr');
  String? _imagePath;
  String _extracted = '';
  bool _processing = false;
  String? _error;

  Future<void> _capture() async {
    setState(() { _processing = true; _error = null; });
    try {
      final picker = await _channel.invokeMethod<String>('pickFromCamera');
      if (picker == null) {
        setState(() { _processing = false; });
        return;
      }
      _imagePath = picker;
      final text = await _channel.invokeMethod<String>('recognizeText', {
        'imagePath': picker,
      });
      if (mounted) setState(() {
        _extracted = text ?? '';
        _processing = false;
      });
    } catch (e) {
      if (mounted) setState(() {
        _error = '$e';
        _processing = false;
      });
    }
  }

  Future<void> _saveAsNote() async {
    if (_extracted.trim().isEmpty) return;
    final v = VaultService(widget.vaultPath);
    final today = DateTime.now().toIso8601String().substring(0, 10);
    final title = 'Escaneo $today';
    final content = '''---
title: $title
type: ocr
date: $today
source: camera
---

# $title

> Capturado con cámara el $today.

```
$_extracted
```

''';
    final path = await v.createNote(
      folder: 'Inbox',
      title: title,
      content: content,
    );
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Guardado: ${p.basename(path)}')),
    );
    Navigator.of(context).pop(path);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Camera OCR', style: TextStyle(fontWeight: FontWeight.w700)),
        actions: [
          if (_extracted.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.save_rounded),
              onPressed: _saveAsNote,
              tooltip: 'Guardar como nota',
            ),
        ],
      ),
      body: SafeArea(
        top: true, bottom: false,
        child: Column(
          children: [
            if (_imagePath != null)
              Container(
                margin: const EdgeInsets.all(MxSpacing.lg),
                height: 200,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(MxRadius.lg),
                  image: DecorationImage(
                    image: FileImage(File(_imagePath!)),
                    fit: BoxFit.cover,
                  ),
                ),
              ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: MxSpacing.lg),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _processing ? null : _capture,
                  icon: const Icon(Icons.camera_alt_outlined),
                  label: Text(_imagePath == null ? 'Capturar apuntes' : 'Volver a capturar'),
                  style: FilledButton.styleFrom(
                    backgroundColor: MxColors.indigoDeep,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                ),
              ),
            ),
            const SizedBox(height: MxSpacing.md),
            Expanded(
              child: _processing
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                      ? Center(child: Padding(
                          padding: const EdgeInsets.all(MxSpacing.xl),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.error_outline, color: Colors.red, size: 48),
                              const SizedBox(height: 8),
                              Text('Error: $_error', textAlign: TextAlign.center),
                              const SizedBox(height: 8),
                              const Text(
                                'El OCR nativo requiere ML Kit Text Recognition.\n'
                                'Si tu build no lo incluye, captura + transcribe manualmente.',
                                textAlign: TextAlign.center,
                                style: TextStyle(fontSize: 11, color: Colors.grey),
                              ),
                            ],
                          ),
                        ))
                      : _extracted.isEmpty
                          ? EmptyState(
                              icon: Icons.document_scanner_outlined,
                              title: 'Sin texto capturado',
                              subtitle: 'Toca "Capturar apuntes" para escanear con la cámara.',
                            )
                          : Container(
                              margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                              padding: const EdgeInsets.all(MxSpacing.md),
                              decoration: BoxDecoration(
                                color: theme.colorScheme.surfaceContainerLow,
                                borderRadius: BorderRadius.circular(MxRadius.md),
                              ),
                              child: SingleChildScrollView(
                                child: Text(_extracted,
                                  style: theme.textTheme.bodyMedium?.copyWith(height: 1.5)),
                              ),
                            ),
            ),
          ],
        ),
      ),
    );
  }
}
