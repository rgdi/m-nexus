// NoteSketchScreen: pantalla modal para dibujar sobre una nota.
//
// v0.48: toma la nota, parsea los strokes del frontmatter (JSON en 'sketches'),
// renderiza el canvas, y al cerrar guarda los strokes actualizados.
//
// Estructura del frontmatter:
//   sketches: |
//     [
//       {"tool":"pen","color":-16777216,"width":3.0,"points":[{"x":10,"y":20},...]},
//       ...
//     ]

import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import '../../services/logger.dart';
import '../../services/vault_service.dart';
import '../../widgets/handwriting_canvas.dart';

class NoteSketchScreen extends StatefulWidget {
  final String notePath;
  final String vaultPath;

  const NoteSketchScreen({
    super.key,
    required this.notePath,
    required this.vaultPath,
  });

  @override
  State<NoteSketchScreen> createState() => _NoteSketchScreenState();
}

class _NoteSketchScreenState extends State<NoteSketchScreen> {
  late final VaultService _vault;
  late List<Stroke> _strokes = [];
  bool _loading = true;
  bool _dirty = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _vault = VaultService(widget.vaultPath);
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final note = await _vault.readNote(widget.notePath);
      _strokes = note != null ? _parseStrokes(note.frontmatter['sketches']) : <Stroke>[];
    } catch (e, s) {
      AdvancedLogger.instance.error('sketch', 'load failed', error: e, stack: s);
      _error = e.toString();
    }
    if (!mounted) return;
    setState(() { _loading = false; });
  }

  Future<void> _save(List<Stroke> strokes) async {
    setState(() { _strokes = strokes; _dirty = true; });
    try {
      // Leer contenido actual
      final note = await _vault.readNote(widget.notePath);
      if (note == null) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Nota no encontrada')),
        );
        return;
      }
      final cleanFm = Map<String, String>.from(note.frontmatter);
      cleanFm['sketches'] = 'json:${jsonEncode(strokes.map((s) => s.toJson()).toList())}';
      // Reconstruir archivo con frontmatter actualizado
      final buffer = StringBuffer()
        ..writeln('---')
        ..writeln('title: ${cleanFm['title'] ?? p.basenameWithoutExtension(widget.notePath)}')
        ..writeln('date: ${cleanFm['date'] ?? DateTime.now().toIso8601String().substring(0, 10)}');
      cleanFm.forEach((k, v) {
        if (k != 'title' && k != 'date') {
          buffer.writeln('$k: $v');
        }
      });
      buffer.writeln('---');
      buffer.writeln();
      buffer.writeln(note.content);
      // Reescribir vía writeNoteAsString (asumiendo VaultService).
      await _vault.writeNote(widget.notePath, buffer.toString());
    } catch (e, s) {
      AdvancedLogger.instance.error('sketch', 'save failed', error: e, stack: s);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error al guardar: $e')),
      );
    }
  }

  List<Stroke> _parseStrokes(String? raw) {
    if (raw == null || raw.isEmpty) return [];
    // Formato: 'json:[[...]]' o directamente '[[...]]'
    var clean = raw.trim();
    if (clean.startsWith('json:')) clean = clean.substring(5);
    try {
      final list = jsonDecode(clean) as List;
      return list.map((j) => Stroke.fromJson(j as Map<String, dynamic>)).toList();
    } catch (_) {
      return [];
    }
  }

  Future<bool> _onWillPop() async {
    if (!_dirty) return true;
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cambios sin guardar'),
        content: const Text('¿Guardar los trazos antes de salir?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Descartar')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Guardar')),
        ],
      ),
    );
    return result ?? false;
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !_dirty,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        if (await _onWillPop() && mounted) {
          Navigator.pop(context);
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text('Dibujar — ${p.basenameWithoutExtension(widget.notePath)}'),
          actions: [
            IconButton(
              icon: const Icon(Icons.save),
              tooltip: 'Guardar',
              onPressed: () async {
                await _save(_strokes);
                if (!mounted) return;
                Navigator.pop(context);
              },
            ),
          ],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(child: Text('Error: $_error'))
                : Padding(
                    padding: const EdgeInsets.all(8),
                    child: HandwritingCanvas(
                      initialStrokes: _strokes,
                      onChanged: (s) => setState(() {
                        _strokes = s;
                        _dirty = true;
                      }),
                    ),
                  ),
      ),
    );
  }
}
