// image_occlusion_editor.dart: editor de oclusiones sobre una imagen.
//
// v0.60 (P1.1): UI estilo Anki. Carga una imagen, permite dibujar
// rectangulos sobre ella, escribir el label por oclusion, y generar
// N flashcards (1 por oclusion) en Approved.

import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import '../../services/image_occlusion_service.dart';

class ImageOcclusionEditor extends StatefulWidget {
  final String vaultPath;
  final String imagePath;
  final String noteTitle;
  const ImageOcclusionEditor({
    super.key,
    required this.vaultPath,
    required this.imagePath,
    this.noteTitle = '',
  });

  @override
  State<ImageOcclusionEditor> createState() => _ImageOcclusionEditorState();
}

class _ImageOcclusionEditorState extends State<ImageOcclusionEditor> {
  final List<Occlusion> _occlusions = [];
  Rect? _currentRect; // rectangulo siendo dibujado
  Size? _imageSize; // tamano natural de la imagen
  int _editingIndex = -1;
  final _labelC = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _labelC.dispose();
    super.dispose();
  }

  Future<void> _loadImageSize() async {
    final file = File(widget.imagePath);
    if (!await file.exists()) return;
    final bytes = await file.readAsBytes();
    // Decodificar tamano con codec simple
    final codec = await (file.path.toLowerCase().endsWith('.png')
      ? _decodePngSize(bytes)
      : _decodeJpegSize(bytes));
    if (codec != null) setState(() => _imageSize = codec);
  }

  Future<Size?> _decodePngSize(Uint8List bytes) async {
    if (bytes.length < 24) return null;
    // PNG: 8-byte signature, then IHDR with width/height at offset 16
    final w = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    final h = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    if (w <= 0 || h <= 0) return null;
    return Size(w.toDouble(), h.toDouble());
  }

  Future<Size?> _decodeJpegSize(Uint8List bytes) async {
    // v0.60: skip para JPEG (Anki usa lib en C). Asumimos cuadrada 1024.
    return const Size(1024, 1024);
  }

  @override
  void initState() {
    super.initState();
    _loadImageSize();
  }

  void _onPanStart(DragStartDetails d, Size canvasSize) {
    if (_editingIndex >= 0) return; // no dibujar mientras edita
    setState(() => _currentRect = Rect.fromLTWH(d.localPosition.dx, d.localPosition.dy, 0, 0));
  }

  void _onPanUpdate(DragUpdateDetails d, Size canvasSize) {
    if (_currentRect == null) return;
    final start = _currentRect!.topLeft;
    final end = d.localPosition;
    setState(() {
      _currentRect = Rect.fromLTRB(
        start.dx < end.dx ? start.dx : end.dx,
        start.dy < end.dy ? start.dy : end.dy,
        start.dx > end.dx ? start.dx : end.dx,
        start.dy > end.dy ? start.dy : end.dy,
      );
    });
  }

  void _onPanEnd(DragEndDetails d) {
    if (_currentRect == null) return;
    if (_currentRect!.width < 16 || _currentRect!.height < 16) {
      setState(() => _currentRect = null);
      return;
    }
    _askLabel(_currentRect!);
  }

  Future<void> _askLabel(Rect r) async {
    final label = await showDialog<String>(
      context: context,
      builder: (ctx) {
        _labelC.text = '';
        return AlertDialog(
          title: const Text('Label de la oclusion'),
          content: TextField(
            controller: _labelC,
            autofocus: true,
            decoration: const InputDecoration(
              hintText: 'p.ej. Nucleo caudado',
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, _labelC.text.trim()),
              child: const Text('Aceptar'),
            ),
          ],
        );
      },
    );
    if (label == null || label.isEmpty) {
      setState(() => _currentRect = null);
      return;
    }
    setState(() {
      _occlusions.add(Occlusion(
        x: r.left, y: r.top, w: r.width, h: r.height, label: label,
      ));
      _currentRect = null;
    });
  }

  Future<void> _save() async {
    if (_occlusions.isEmpty) return;
    setState(() => _saving = true);
    try {
      final svc = ImageOcclusionService(widget.vaultPath);
      await svc.createOcclusionCards(
        sourceImage: widget.imagePath,
        occlusions: _occlusions,
        noteTitle: widget.noteTitle,
      );
      if (!mounted) return;
      Navigator.pop(context, _occlusions.length);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('${_occlusions.length} flashcards creadas'),
      ));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ocultar imagen'),
        actions: [
          if (_occlusions.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.delete_sweep),
              onPressed: () => setState(_occlusions.clear),
              tooltip: 'Limpiar todas',
            ),
          if (_occlusions.isNotEmpty)
            IconButton(
              icon: _saving
                ? const SizedBox(width: 18, height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.save),
              onPressed: _saving ? null : _save,
              tooltip: 'Crear flashcards',
            ),
        ],
      ),
      body: Column(
        children: [
          if (_imageSize != null) Text(
            'Imagen: ${_imageSize!.width.toInt()} x ${_imageSize!.height.toInt()}',
            style: const TextStyle(fontSize: 11, color: Colors.grey),
          ),
          Expanded(
            child: LayoutBuilder(builder: (ctx, constraints) {
              final canvasSize = Size(constraints.maxWidth, constraints.maxHeight);
              return GestureDetector(
                onPanStart: (d) => _onPanStart(d, canvasSize),
                onPanUpdate: (d) => _onPanUpdate(d, canvasSize),
                onPanEnd: _onPanEnd,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (File(widget.imagePath).existsSync())
                      Image.file(File(widget.imagePath), fit: BoxFit.contain)
                    else
                      const Center(child: Text('Imagen no encontrada')),
                    // Oclusiones existentes
                    ..._occlusions.asMap().entries.map((e) => Positioned(
                      left: e.value.x, top: e.value.y,
                      width: e.value.w, height: e.value.h,
                      child: GestureDetector(
                        onTap: () => _editOcclusion(e.key),
                        child: Container(
                          decoration: BoxDecoration(
                            color: Colors.purple.withValues(alpha: 0.6),
                            border: Border.all(color: Colors.purple, width: 2),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Center(
                            child: Text(
                              e.value.label,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                              ),
                              textAlign: TextAlign.center,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ),
                      ),
                    )),
                    // Rect actual siendo dibujado
                    if (_currentRect != null) Positioned(
                      left: _currentRect!.left, top: _currentRect!.top,
                      width: _currentRect!.width, height: _currentRect!.height,
                      child: Container(
                        decoration: BoxDecoration(
                          color: Colors.orange.withValues(alpha: 0.3),
                          border: Border.all(color: Colors.orange, width: 2),
                        ),
                      ),
                    ),
                  ],
                ),
              );
            }),
          ),
          Container(
            color: Theme.of(context).colorScheme.surfaceContainerHigh,
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                const Icon(Icons.touch_app, size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _occlusions.isEmpty
                      ? 'Dibuja un rectangulo sobre la imagen para ocluir una region. Aparece un dialogo para label.'
                      : '${_occlusions.length} oclusion(es) creada(s). Toca una para editar/eliminar.',
                    style: const TextStyle(fontSize: 12),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _editOcclusion(int index) async {
    final occ = _occlusions[index];
    final action = await showDialog<String>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: Text(occ.label),
        children: [
          SimpleDialogOption(
            onPressed: () => Navigator.pop(ctx, 'rename'),
            child: const Text('Renombrar label'),
          ),
          SimpleDialogOption(
            onPressed: () => Navigator.pop(ctx, 'delete'),
            child: const Text('Eliminar', style: TextStyle(color: Colors.red)),
          ),
          SimpleDialogOption(
            onPressed: () => Navigator.pop(ctx, 'cancel'),
            child: const Text('Cancelar'),
          ),
        ],
      ),
    );
    if (action == 'rename') {
      _labelC.text = occ.label;
      final newLabel = await showDialog<String>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Renombrar label'),
          content: TextField(controller: _labelC, autofocus: true),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, _labelC.text.trim()),
              child: const Text('Aceptar'),
            ),
          ],
        ),
      );
      if (newLabel != null && newLabel.isNotEmpty) {
        setState(() {
          _occlusions[index] = Occlusion(
            x: occ.x, y: occ.y, w: occ.w, h: occ.h, label: newLabel,
          );
        });
      }
    } else if (action == 'delete') {
      setState(() => _occlusions.removeAt(index));
    }
  }
}
