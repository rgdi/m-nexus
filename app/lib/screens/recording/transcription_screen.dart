// transcription_screen.dart — pantalla de transcripción de audio.
// v0.62.18: usa el endpoint /api/v1/audio/transcribe del backend. Muestra
// el estado de la transcripción + texto resultado. Si no hay backend,
// muestra instrucciones para grabar localmente y transcribir manual.

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import '../../core/design_tokens.dart';
import '../../services/settings_service.dart';
import '../../widgets/empty_state.dart';

class TranscriptionScreen extends StatefulWidget {
  final String vaultPath;
  const TranscriptionScreen({super.key, required this.vaultPath});
  @override
  State<TranscriptionScreen> createState() => _TranscriptionScreenState();
}

class _TranscriptionScreenState extends State<TranscriptionScreen> {
  String? _selectedPath;
  String? _resultText;
  bool _busy = false;
  String? _error;

  Future<void> _pickAudio() async {
    // Por simplicidad: el usuario pega el path al archivo. Una
    // implementación completa usaría file_picker.
    final ctrl = TextEditingController();
    final r = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Path del archivo de audio'),
        content: TextField(
          controller: ctrl,
          decoration: const InputDecoration(
            hintText: '/sdcard/recording.m4a',
            labelText: 'Path absoluto',
          ),
          autofocus: true,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
            child: const Text('OK'),
          ),
        ],
      ),
    );
    if (r != null && r.isNotEmpty) {
      setState(() => _selectedPath = r);
    }
  }

  Future<void> _transcribe() async {
    if (_selectedPath == null) {
      _pickAudio();
      return;
    }
    final base = SettingsService.instance.current.backendUrl;
    if (base == null || base.isEmpty) {
      setState(() => _error = 'Sin backend configurado en Ajustes');
      return;
    }
    setState(() { _busy = true; _error = null; _resultText = null; });
    try {
      final uri = Uri.parse('$base/api/v1/audio/transcribe');
      final req = http.MultipartRequest('POST', uri)
        ..files.add(await http.MultipartFile.fromPath('audio', _selectedPath!));
      final streamed = await req.send();
      final body = await streamed.stream.bytesToString();
      if (streamed.statusCode == 200) {
        setState(() {
          _resultText = body;
          _busy = false;
        });
      } else {
        setState(() {
          _error = 'Error ${streamed.statusCode}: $body';
          _busy = false;
        });
      }
    } catch (e) {
      setState(() { _error = '$e'; _busy = false; });
    }
  }

  void _saveAsNote() async {
    if (_resultText == null || _resultText!.trim().isEmpty) return;
    final base = SettingsService.instance.current.backendUrl;
    if (base == null) return;
    final today = DateTime.now().toIso8601String().substring(0, 10);
    final title = 'Transcripción $today';
    final content = '''---
title: $title
type: transcription
date: $today
source: $base
---

# $title

> Transcrito el $today.

```
$_resultText
```

''';
    final f = File(p.join(widget.vaultPath, 'transcripcion-$today.md'));
    await f.writeAsString(content, flush: true);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Guardado: ${p.basename(f.path)}')),
    );
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Transcripción de audio',
          style: TextStyle(fontWeight: FontWeight.w700)),
        actions: [
          if (_resultText != null)
            IconButton(
              icon: const Icon(Icons.save_rounded),
              onPressed: _saveAsNote,
              tooltip: 'Guardar como nota',
            ),
        ],
      ),
      body: SafeArea(
        top: true, bottom: false,
        child: ListView(
          padding: const EdgeInsets.all(MxSpacing.lg),
          children: [
            Container(
              padding: const EdgeInsets.all(MxSpacing.md),
              decoration: BoxDecoration(
                color: MxColors.violet.withOpacity(0.10),
                borderRadius: BorderRadius.circular(MxRadius.md),
                border: Border.all(color: MxColors.violet.withOpacity(0.3)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.auto_awesome, color: MxColors.violet),
                  const SizedBox(width: MxSpacing.sm),
                  Expanded(
                    child: Text(
                      'Transcripción vía backend (Whisper local en el server).',
                      style: theme.textTheme.bodyMedium,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: MxSpacing.lg),
            // Selector de archivo.
            InkWell(
              onTap: _pickAudio,
              borderRadius: BorderRadius.circular(MxRadius.md),
              child: Container(
                padding: const EdgeInsets.all(MxSpacing.lg),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerLow,
                  borderRadius: BorderRadius.circular(MxRadius.md),
                  border: Border.all(
                    color: _selectedPath == null
                        ? theme.colorScheme.outlineVariant
                        : MxColors.indigoDeep,
                  ),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.audio_file_outlined, size: 24),
                    const SizedBox(width: MxSpacing.md),
                    Expanded(
                      child: Text(
                        _selectedPath ?? 'Toca para seleccionar archivo de audio',
                        style: theme.textTheme.bodyMedium,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: MxSpacing.lg),
            FilledButton.icon(
              onPressed: _busy ? null : _transcribe,
              icon: const Icon(Icons.transcribe_rounded),
              label: Text(_busy ? 'Transcribiendo…' : 'Transcribir'),
              style: FilledButton.styleFrom(
                backgroundColor: MxColors.indigoDeep,
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: MxSpacing.md),
              Container(
                padding: const EdgeInsets.all(MxSpacing.md),
                decoration: BoxDecoration(
                  color: Colors.red.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(MxRadius.md),
                ),
                child: Text(_error!, style: const TextStyle(color: Colors.red)),
              ),
            ],
            if (_resultText != null) ...[
              const SizedBox(height: MxSpacing.lg),
              Text('Resultado', style: theme.textTheme.titleMedium),
              const SizedBox(height: MxSpacing.sm),
              Container(
                padding: const EdgeInsets.all(MxSpacing.md),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHigh,
                  borderRadius: BorderRadius.circular(MxRadius.md),
                ),
                child: SelectableText(
                  _resultText!,
                  style: theme.textTheme.bodyMedium?.copyWith(height: 1.5),
                ),
              ),
            ],
            if (_resultText == null && !_busy)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Text(
                  'Sin transcripción todavía. Selecciona un archivo .m4a/.wav/.mp3 y pulsa Transcribir.',
                  style: TextStyle(color: Colors.grey),
                  textAlign: TextAlign.center,
                ),
              ),
          ],
        ),
      ),
    );
  }
}
