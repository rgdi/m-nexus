// PermissionService: gestión unificada de todos los permisos que necesita
// la app companion. Solicita de forma inteligente (uno por uno, con
// explicación cuando son denegados permanentemente).
//
// v0.32: solicita permisos en grupos, no en cascada. Si el usuario
// rechaza uno, sigue con el siguiente. Lleva registro de cuáles están
// denegados permanentemente para mostrar UI explicativa.

import 'dart:io';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:permission_handler/permission_handler.dart' as ph show PermissionStatus;

class PermissionStatus {
  final String name;
  final String displayName;
  final String description;
  final bool granted;
  final bool permanentlyDenied;

  const PermissionStatus({
    required this.name,
    required this.displayName,
    required this.description,
    required this.granted,
    required this.permanentlyDenied,
  });
}

class PermissionsService {
  /// IDs de los permisos que gestionamos.
  static const _permissions = [
    _PermSpec(
      id: 'storage',
      name: 'Almacenamiento',
      description: 'Acceso al vault de Obsidian y al almacenamiento externo',
    ),
    _PermSpec(
      id: 'microphone',
      name: 'Micrófono',
      description: 'Para grabar clases (voice notes)',
    ),
    _PermSpec(
      id: 'calendar',
      name: 'Google Calendar',
      description: 'Para detectar eventos de clase y sugerir nombres',
    ),
    _PermSpec(
      id: 'notifications',
      name: 'Notificaciones',
      description: 'Avisarte de nuevas versiones y eventos de clase',
    ),
    _PermSpec(
      id: 'install_unknown',
      name: 'Instalar apps',
      description: 'Necesario para auto-actualizar el companion',
    ),
    _PermSpec(
      id: 'manage_storage',
      name: 'Acceso total al almacenamiento',
      description: 'Para acceder a vaults de Obsidian en /sdcard o USB (Android 11+). Solo si el detector automático no encuentra tu vault.',
    ),
  ];

  /// Devuelve el estado actual de todos los permisos.
  static Future<List<PermissionStatus>> getAll() async {
    final statuses = <PermissionStatus>[];

    for (final spec in _permissions) {
      final status = await _checkOne(spec);
      statuses.add(status);
    }
    return statuses;
  }

  /// Solicita TODOS los permisos uno por uno. Devuelve los resultados.
  /// NO lanza errores; si el usuario rechaza uno, sigue con el siguiente.
  static Future<List<PermissionStatus>> requestAll() async {
    final results = <PermissionStatus>[];
    for (final spec in _permissions) {
      try {
        final status = await _requestOne(spec);
        results.add(status);
      } catch (e) {
        results.add(PermissionStatus(
          name: spec.id,
          displayName: spec.name,
          description: spec.description,
          granted: false,
          permanentlyDenied: false,
        ));
      }
    }
    return results;
  }

  /// Solicita un permiso específico. Devuelve el nuevo estado.
  static Future<PermissionStatus> request(String id) async {
    final spec = _permissions.firstWhere(
      (p) => p.id == id,
      orElse: () => _permissions.first,
    );
    return _requestOne(spec);
  }

  /// Abre la app de Settings del sistema (cuando está permanentemente denegado).
  static Future<bool> openSettings() async {
    if (!Platform.isAndroid) return false;
    try {
      return await openAppSettings();
    } catch (_) {
      return false;
    }
  }

  /// v0.34: abre la pantalla de "Acceso a todos los archivos" (MANAGE_EXTERNAL_STORAGE)
  /// que es distinta de la pantalla normal de Settings.
  /// En Android 11+ este permiso debe otorgarse desde una pantalla especial.
  static Future<bool> openManageStorageSettings() async {
    if (!Platform.isAndroid) return false;
    try {
      const channel = MethodChannel('com.mnexus.installer/permissions');
      final result = await channel.invokeMethod<bool>('openManageStorageSettings');
      return result ?? false;
    } catch (_) {
      // Fallback al método estándar
      return openAppSettings();
    }
  }

  /// v0.34: comprueba si MANAGE_EXTERNAL_STORAGE está concedido (sin pedirlo).
  /// Útil para mostrar UI explicativa.
  static Future<bool> isManageStorageGranted() async {
    if (!Platform.isAndroid) return true;
    try {
      const channel = MethodChannel('com.mnexus.installer/permissions');
      final result = await channel.invokeMethod<bool>('isManageStorageGranted');
      return result ?? false;
    } catch (_) {
      return false;
    }
  }

  // ── Internals ───────────────────────────────────────

  static Future<PermissionStatus> _checkOne(_PermSpec spec) async {
    if (!Platform.isAndroid) {
      return PermissionStatus(
        name: spec.id,
        displayName: spec.name,
        description: spec.description,
        granted: true,
        permanentlyDenied: false,
      );
    }
    Permission? perm = _toPermissionHandler(spec.id);
    if (perm == null) {
      return PermissionStatus(
        name: spec.id,
        displayName: spec.name,
        description: spec.description,
        granted: true,
        permanentlyDenied: false,
      );
    }
    final status = await perm.status;
    return PermissionStatus(
      name: spec.id,
      displayName: spec.name,
      description: spec.description,
      granted: status.isGranted,
      permanentlyDenied: status.isPermanentlyDenied,
    );
  }

  static Future<PermissionStatus> _requestOne(_PermSpec spec) async {
    if (!Platform.isAndroid) {
      return PermissionStatus(
        name: spec.id,
        displayName: spec.name,
        description: spec.description,
        granted: true,
        permanentlyDenied: false,
      );
    }
    Permission? perm = _toPermissionHandler(spec.id);
    if (perm == null) {
      return PermissionStatus(
        name: spec.id,
        displayName: spec.name,
        description: spec.description,
        granted: true,
        permanentlyDenied: false,
      );
    }
    final result = await perm.request();
    return PermissionStatus(
      name: spec.id,
      displayName: spec.name,
      description: spec.description,
      granted: result.isGranted,
      permanentlyDenied: result.isPermanentlyDenied ||
          (perm.status == ph.PermissionStatus.permanentlyDenied),
    );
  }

  static Permission? _toPermissionHandler(String id) {
    switch (id) {
      case 'storage': return Permission.storage;
      case 'microphone': return Permission.microphone;
      case 'calendar': return Permission.calendarFullAccess;
      case 'notifications': return Permission.notification;
      case 'install_unknown': return Permission.requestInstallPackages;
      case 'manage_storage': return Permission.manageExternalStorage;
      default: return null;
    }
  }
}

class _PermSpec {
  final String id;
  final String name;
  final String description;
  const _PermSpec({
    required this.id,
    required this.name,
    required this.description,
  });
}
