// Tests para la integración del image_picker en el editor de notas.
//
// Estrategia: monkey-patching a un `FakeImagePicker` que sustituye la
// implementación por defecto de `ImagePicker.pickImage`. El helper
// `pickAndInsertImage` toma un `ImagePicker` inyectado, así que la lógica
// de selección/copia/inserción se ejercita con un vault real (en
// `Directory.systemTemp`) sin necesidad de tocar el sistema de archivos
// del usuario ni abrir un diálogo nativo.

import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mnexus_app/screens/note/note_editor.dart';
import 'package:path/path.dart' as p;

/// Fake ImagePicker que devuelve un archivo pre-existente o `null`.
class FakeImagePicker extends ImagePicker {
  FakeImagePicker({this.nextFile, this.throwOnPick = false});

  /// Ruta absoluta al archivo que debe devolver `pickImage`. Si es
  /// `null`, `pickImage` devolverá `null` (caso "usuario canceló").
  final String? nextFile;

  /// Si es `true`, `pickImage` lanza una excepción simulando un error
  /// de plataforma.
  final bool throwOnPick;

  int callCount = 0;
  ImageSource? lastSource;

  @override
  Future<XFile?> pickImage({
    required ImageSource source,
    double? maxWidth,
    double? maxHeight,
    int? imageQuality,
    CameraDevice preferredCameraDevice = CameraDevice.rear,
    bool requestFullMetadata = true,
  }) async {
    callCount += 1;
    lastSource = source;
    if (throwOnPick) {
      throw Exception('fake platform error');
    }
    final f = nextFile;
    if (f == null) return null;
    return XFile(f);
  }
}

Future<File> _writeTempImage(Directory dir, String name, String ext) async {
  final f = File(p.join(dir.path, '$name.$ext'));
  await f.writeAsBytes(<int>[0x89, 0x50, 0x4E, 0x47]); // PNG magic
  return f;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory vaultDir;
  late Directory sourceDir;

  setUp(() async {
    vaultDir = await Directory.systemTemp.createTemp('vault-imgpicker-test-');
    sourceDir = await Directory.systemTemp.createTemp('src-imgpicker-test-');
  });

  tearDown(() async {
    if (await vaultDir.exists()) await vaultDir.delete(recursive: true);
    if (await sourceDir.exists()) await sourceDir.delete(recursive: true);
  });

  group('pickAndInsertImage', () {
    test('copia el archivo a _M-NEXUS/images/<uuid>.png e inserta el '
        'markdown ![alt](relative_path) en la posición del cursor',
        () async {
      final src = await _writeTempImage(sourceDir, 'photo', 'png');
      final picker = FakeImagePicker(nextFile: src.path);
      final controller = TextEditingController(
        text: 'Antes-Después',
      );
      // Cursor entre "Antes-" y "Después" → offset = 6.
      controller.selection = const TextSelection.collapsed(offset: 6);
      final focus = FocusNode();

      await pickAndInsertImage(
        picker: picker,
        vaultPath: vaultDir.path,
        bodyController: controller,
        bodyFocus: focus,
      );

      // pickImage se llamó exactamente una vez, pidiendo galería.
      expect(picker.callCount, 1);
      expect(picker.lastSource, ImageSource.gallery);

      // El cuerpo debe contener el markdown insertado entre medias.
      final body = controller.text;
      expect(body.startsWith('Antes-'), isTrue,
          reason: 'el texto previo debe preservarse: $body');
      expect(body.endsWith('Después'), isTrue,
          reason: 'el texto posterior debe preservarse: $body');

      // Extraer la inserción: debe ser ![image](_M-NEXUS/images/<uuid>.png)
      final beforeLen = 'Antes-'.length;
      final afterStart = body.indexOf('Después');
      final inserted = body.substring(beforeLen, afterStart);
      final md = RegExp(r'^\!\[image\]\(_M-NEXUS/images/[a-f0-9-]+\.png\)$');
      expect(md.hasMatch(inserted), isTrue,
          reason: 'markdown mal formado: "$inserted"');

      // El cursor debe estar justo después del markdown insertado.
      expect(
        controller.selection.baseOffset,
        beforeLen + inserted.length,
        reason: 'el cursor debe quedar al final de la inserción',
      );

      // El archivo de destino debe existir en el vault.
      final relMatch = RegExp(r'_M-NEXUS/images/([a-f0-9-]+\.png)')
          .firstMatch(inserted)!;
      final relPath = relMatch.group(0)!;
      final absDst = p.join(vaultDir.path, relPath);
      expect(File(absDst).existsSync(), isTrue,
          reason: 'la imagen debe existir en $absDst');
    });

    test('preserva la extensión original (jpg, jpeg, webp)', () async {
      for (final ext in <String>['jpg', 'jpeg', 'webp']) {
        final src = await _writeTempImage(sourceDir, 'photo_$ext', ext);
        final picker = FakeImagePicker(nextFile: src.path);
        final controller = TextEditingController(text: '');
        controller.selection = const TextSelection.collapsed(offset: 0);
        final focus = FocusNode();

        await pickAndInsertImage(
          picker: picker,
          vaultPath: vaultDir.path,
          bodyController: controller,
          bodyFocus: focus,
        );

        final body = controller.text;
        final md = RegExp(
                r'^!\[image\]\(_M-NEXUS/images/[a-f0-9-]+\.' + ext + r'\)$')
            .hasMatch(body);
        expect(md, isTrue,
            reason: 'markdown mal formado para ext=$ext: "$body"');
      }
    });

    test('usuario cancela (picker devuelve null) → no inserta nada',
        () async {
      final picker = FakeImagePicker(nextFile: null);
      final controller = TextEditingController(text: 'sin cambios');
      controller.selection = const TextSelection.collapsed(offset: 5);
      final focus = FocusNode();

      await pickAndInsertImage(
        picker: picker,
        vaultPath: vaultDir.path,
        bodyController: controller,
        bodyFocus: focus,
      );

      expect(controller.text, 'sin cambios');
      expect(controller.selection.baseOffset, 5);
      // No debe haberse creado el directorio de imágenes.
      expect(
        Directory(p.join(vaultDir.path, '_M-NEXUS', 'images'))
            .existsSync(),
        isFalse,
      );
    });

    test('si picker lanza, no rompe y no inserta nada', () async {
      final picker = FakeImagePicker(throwOnPick: true);
      final controller = TextEditingController(text: 'intacto');
      controller.selection = const TextSelection.collapsed(offset: 3);
      final focus = FocusNode();

      await pickAndInsertImage(
        picker: picker,
        vaultPath: vaultDir.path,
        bodyController: controller,
        bodyFocus: focus,
      );

      expect(controller.text, 'intacto');
      expect(picker.callCount, 1);
    });

    test('crea el subdirectorio _M-NEXUS/images si no existía',
        () async {
      final src = await _writeTempImage(sourceDir, 'first', 'png');
      final picker = FakeImagePicker(nextFile: src.path);
      final controller = TextEditingController(text: '');
      controller.selection = const TextSelection.collapsed(offset: 0);
      final focus = FocusNode();

      // Antes: el subdir no debe existir.
      final imagesDir =
          Directory(p.join(vaultDir.path, '_M-NEXUS', 'images'));
      expect(imagesDir.existsSync(), isFalse);

      await pickAndInsertImage(
        picker: picker,
        vaultPath: vaultDir.path,
        bodyController: controller,
        bodyFocus: focus,
      );

      expect(imagesDir.existsSync(), isTrue);
    });
  });
}