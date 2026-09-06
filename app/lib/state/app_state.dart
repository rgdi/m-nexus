// App state global: vault activo, ruta actual, etc.
// Usa ChangeNotifier (suficiente para esta app).

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import '../services/vault_detector.dart';

class AppState extends ChangeNotifier {
  VaultInfo? _activeVault;
  String? _activeNotePath;
  bool _loading = false;

  VaultInfo? get activeVault => _activeVault;
  String? get activeNotePath => _activeNotePath;
  bool get loading => _loading;
  bool get hasVault => _activeVault != null;

  /// Carga el vault activo desde SharedPreferences o del primero detectado.
  Future<void> init() async {
    _loading = true;
    notifyListeners();
    final detector = VaultDetector();
    final vaults = await detector.detectVaults();
    if (vaults.isNotEmpty) {
      _activeVault = vaults.first;
    }
    _loading = false;
    notifyListeners();
  }

  /// Cambia el vault activo.
  void setVault(VaultInfo vault) {
    _activeVault = vault;
    _activeNotePath = null;
    notifyListeners();
  }

  /// Cambia la nota activa (ruta relativa al vault).
  void setActiveNote(String? relativePath) {
    _activeNotePath = relativePath;
    notifyListeners();
  }

  /// Devuelve la ruta absoluta de la nota activa (si hay).
  String? get activeNoteFullPath {
    if (_activeVault == null || _activeNotePath == null) return null;
    return p.join(_activeVault!.path, _activeNotePath!);
  }
}
