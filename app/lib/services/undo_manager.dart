// undo_manager.dart: undo/redo para operaciones destructivas.
//
// v0.60 (P3.4): stack de operaciones reversibles. Cubre:
//   - note: create/delete/rename/move
//   - flashcard: create/delete/edit
//   - subject: create/delete
//
// Cada operacion expone apply() y revert(). El stack guarda
// las operaciones aplicadas y permite deshacer/rehacer.

import 'dart:io';
import 'package:path/path.dart' as p;
import 'logger.dart';

abstract class UndoableOp {
  String get id;
  String get description;
  Future<void> apply();
  Future<void> revert();
}

class NoteDeleteOp implements UndoableOp {
  final String vaultPath;
  final String notePath;
  final String contentBackup;
  @override
  final String id;
  @override
  final String description;
  NoteDeleteOp({
    required this.vaultPath,
    required this.notePath,
    required this.contentBackup,
  }) : id = 'note-delete-${DateTime.now().millisecondsSinceEpoch}',
       description = 'Eliminar ${p.basename(notePath)}';

  @override
  Future<void> apply() async {
    final f = File(notePath);
    if (await f.exists()) await f.delete();
  }

  @override
  Future<void> revert() async {
    final f = File(notePath);
    await f.parent.create(recursive: true);
    await f.writeAsString(contentBackup);
  }
}

class NoteRenameOp implements UndoableOp {
  final String vaultPath;
  final String oldPath;
  final String newPath;
  @override
  final String id;
  @override
  final String description;
  NoteRenameOp({
    required this.vaultPath,
    required this.oldPath,
    required this.newPath,
  }) : id = 'note-rename-${DateTime.now().millisecondsSinceEpoch}',
       description = 'Renombrar ${p.basename(oldPath)} -> ${p.basename(newPath)}';

  @override
  Future<void> apply() async {
    final f = File(oldPath);
    if (await f.exists()) {
      await File(newPath).parent.create(recursive: true);
      await f.rename(newPath);
    }
  }

  @override
  Future<void> revert() async {
    final f = File(newPath);
    if (await f.exists()) {
      await File(oldPath).parent.create(recursive: true);
      await f.rename(oldPath);
    }
  }
}

class NoteCreateOp implements UndoableOp {
  final String notePath;
  final String content;
  @override
  final String id;
  @override
  final String description;
  NoteCreateOp({required this.notePath, required this.content})
    : id = 'note-create-${DateTime.now().millisecondsSinceEpoch}',
      description = 'Crear ${p.basename(notePath)}';

  @override
  Future<void> apply() async {
    final f = File(notePath);
    await f.parent.create(recursive: true);
    await f.writeAsString(content);
  }

  @override
  Future<void> revert() async {
    final f = File(notePath);
    if (await f.exists()) await f.delete();
  }
}

class UndoManager {
  final List<UndoableOp> _undoStack = [];
  final List<UndoableOp> _redoStack = [];
  final int maxStack;
  final void Function()? onChange;

  UndoManager({this.maxStack = 100, this.onChange});

  bool get canUndo => _undoStack.isNotEmpty;
  bool get canRedo => _redoStack.isNotEmpty;
  UndoableOp? get topUndo => _undoStack.isNotEmpty ? _undoStack.last : null;
  UndoableOp? get topRedo => _redoStack.isNotEmpty ? _redoStack.last : null;

  /// v0.60 (P3.4): registra una operacion aplicada. Clear redo stack.
  Future<void> record(UndoableOp op) async {
    _undoStack.add(op);
    if (_undoStack.length > maxStack) {
      _undoStack.removeAt(0);
    }
    _redoStack.clear();
    onChange?.call();
  }

  /// v0.60 (P3.4): aplica una op y la registra.
  Future<void> apply(UndoableOp op) async {
    await op.apply();
    await record(op);
  }

  /// v0.60 (P3.4): undo top operation.
  Future<UndoableOp?> undo() async {
    if (!canUndo) return null;
    final op = _undoStack.removeLast();
    try {
      await op.revert();
      _redoStack.add(op);
      AdvancedLogger.instance.info('undo', 'reverted', context: {
        'op': op.id, 'desc': op.description,
      });
    } catch (e) {
      AdvancedLogger.instance.warn('undo', 'revert failed', error: e.toString());
    }
    onChange?.call();
    return op;
  }

  /// v0.60 (P3.4): redo top operation.
  Future<UndoableOp?> redo() async {
    if (!canRedo) return null;
    final op = _redoStack.removeLast();
    try {
      await op.apply();
      _undoStack.add(op);
      AdvancedLogger.instance.info('undo', 'redone', context: {
        'op': op.id, 'desc': op.description,
      });
    } catch (e) {
      AdvancedLogger.instance.warn('undo', 'redo failed', error: e.toString());
    }
    onChange?.call();
    return op;
  }

  void clear() {
    _undoStack.clear();
    _redoStack.clear();
    onChange?.call();
  }

  List<String> get undoDescriptions => _undoStack.map((o) => o.description).toList().reversed.toList();
  List<String> get redoDescriptions => _redoStack.map((o) => o.description).toList().reversed.toList();
}
