// gestures.dart: mobile gestures y haptics (v0.62.1).
//
// Cubre:
//   - SwipeToDelete: desliza para eliminar
//   - SwipeToAction: desliza para accion custom (archive, complete, etc)
//   - PullToRefresh: pull para refrescar
//   - HapticFeedback wrapper para consistencia
//   - LongPressMenu: menu contextual al mantener pulsado
//
// Requiere flutter pub get de `flutter_slidable` (no incluido por defecto).

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class HapticHelper {
  /// v0.62.1: wrapper de HapticFeedback con seleccion de intensidad.
  static Future<void> light() => HapticFeedback.lightImpact();
  static Future<void> medium() => HapticFeedback.mediumImpact();
  static Future<void> heavy() => HapticFeedback.heavyImpact();
  static Future<void> selection() => HapticFeedback.selectionClick();
  static Future<void> vibrate() => HapticFeedback.vibrate();
}

/// v0.62.1: SwipeToDelete widget. Reveal a delete button on horizontal drag.
class SwipeToDelete extends StatelessWidget {
  final Widget child;
  final Future<bool> Function() onDelete;
  final String confirmMessage;
  final Color? deleteColor;
  const SwipeToDelete({
    super.key,
    required this.child,
    required this.onDelete,
    this.confirmMessage = '¿Eliminar?',
    this.deleteColor,
  });

  @override
  Widget build(BuildContext context) {
    return Dismissible(
      key: ValueKey(child.key ?? DateTime.now().millisecondsSinceEpoch),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.symmetric(horizontal: 24),
        decoration: BoxDecoration(
          color: deleteColor ?? Colors.red,
          borderRadius: BorderRadius.circular(8),
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.delete_outline, color: Colors.white),
            SizedBox(width: 8),
            Text('Eliminar', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ],
        ),
      ),
      confirmDismiss: (direction) async {
        HapticHelper.medium();
        return await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Confirmar'),
            content: Text(confirmMessage),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                style: FilledButton.styleFrom(backgroundColor: Colors.red),
                child: const Text('Eliminar'),
              ),
            ],
          ),
        ) ?? false;
      },
      onDismissed: (direction) async {
        HapticHelper.heavy();
        await onDelete();
      },
      child: child,
    );
  }
}

/// v0.62.1: SwipeToAction widget. Reveal N actions on horizontal drag.
class SwipeAction {
  final IconData icon;
  final String label;
  final Color color;
  final Future<void> Function() onTap;
  SwipeAction({required this.icon, required this.label, required this.color, required this.onTap});
}

class SwipeToAction extends StatelessWidget {
  final Widget child;
  final List<SwipeAction> actions;
  const SwipeToAction({super.key, required this.child, required this.actions});

  @override
  Widget build(BuildContext context) {
    if (actions.isEmpty) return child;
    return Dismissible(
      key: ValueKey(child.key ?? DateTime.now().millisecondsSinceEpoch),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        decoration: BoxDecoration(
          color: actions.first.color,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(actions.first.icon, color: Colors.white),
            const SizedBox(width: 6),
            Text(actions.first.label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            if (actions.length > 1) ...[
              const SizedBox(width: 16),
              Icon(actions[1].icon, color: Colors.white),
              const SizedBox(width: 6),
              Text(actions[1].label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            ],
          ],
        ),
      ),
      confirmDismiss: (_) async {
        HapticHelper.medium();
        return true;
      },
      onDismissed: (_) async {
        for (final a in actions) {
          await a.onTap();
        }
        // Restaurar el widget (Dismissible lo remueve)
        if (context.mounted) {
          // v0.62.1: dispara rebuild via setState del padre
          (context as Element).markNeedsBuild();
        }
      },
      child: child,
    );
  }
}

/// v0.62.1: PullToRefresh widget wrapper.
class PullToRefresh extends StatelessWidget {
  final Future<void> Function() onRefresh;
  final Widget child;
  final Color? color;
  const PullToRefresh({super.key, required this.onRefresh, required this.child, this.color});

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async {
        HapticHelper.light();
        await onRefresh();
      },
      color: color,
      child: child,
    );
  }
}

/// v0.62.1: LongPressMenu wrapper. Muestra un menu al mantener pulsado.
class LongPressMenu extends StatelessWidget {
  final Widget child;
  final List<PopupMenuEntry<String>> items;
  final void Function(String) onSelected;
  const LongPressMenu({super.key, required this.child, required this.items, required this.onSelected});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onLongPress: () async {
        HapticHelper.medium();
        await showMenu<String>(
          context: context,
          position: RelativeRect.fromLTRB(100, 200, 100, 200),
          items: items,
        ).then((value) {
          if (value != null) onSelected(value);
        });
      },
      child: child,
    );
  }
}
