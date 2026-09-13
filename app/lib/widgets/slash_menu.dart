// slash_menu.dart — AFFiNE-style slash menu (/key).
// v0.62.16: al pulsar "/" dentro del editor de nota aparece un menú
// flotante con comandos para insertar markdown estructurado.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../core/design_tokens.dart';

class SlashCommand {
  final String label;
  final String description;
  final IconData icon;
  final String insert; // texto a insertar (sin markdown)
  final int cursorOffset; // posición del cursor relativa al insert
  const SlashCommand({
    required this.label,
    required this.description,
    required this.icon,
    required this.insert,
    required this.cursorOffset,
  });
}

const _kCommands = <SlashCommand>[
  SlashCommand(
    label: 'Encabezado 1', description: 'Título grande (#)',
    icon: Icons.title_rounded, insert: '# ', cursorOffset: 2,
  ),
  SlashCommand(
    label: 'Encabezado 2', description: 'Sección (##)',
    icon: Icons.title_rounded, insert: '## ', cursorOffset: 3,
  ),
  SlashCommand(
    label: 'Encabezado 3', description: 'Subsección (###)',
    icon: Icons.title_rounded, insert: '### ', cursorOffset: 4,
  ),
  SlashCommand(
    label: 'Lista', description: 'Lista no ordenada (-)',
    icon: Icons.format_list_bulleted_rounded, insert: '- ', cursorOffset: 2,
  ),
  SlashCommand(
    label: 'Lista numerada', description: 'Lista ordenada (1.)',
    icon: Icons.format_list_numbered_rounded, insert: '1. ', cursorOffset: 3,
  ),
  SlashCommand(
    label: 'Checklist', description: 'Tarea (- [ ])',
    icon: Icons.check_box_outlined, insert: '- [ ] ', cursorOffset: 6,
  ),
  SlashCommand(
    label: 'Cita', description: 'Bloque citado (>)',
    icon: Icons.format_quote_rounded, insert: '> ', cursorOffset: 2,
  ),
  SlashCommand(
    label: 'Código', description: 'Bloque de código (```)',
    icon: Icons.code_rounded, insert: '```\n\n```', cursorOffset: 4,
  ),
  SlashCommand(
    label: 'Separador', description: 'Línea horizontal (---)',
    icon: Icons.horizontal_rule_rounded, insert: '\n---\n', cursorOffset: 5,
  ),
  SlashCommand(
    label: 'Cloze', description: 'Tarjeta cloze ({{c1::...}})',
    icon: Icons.style_outlined, insert: '{{c1::texto}}', cursorOffset: 6,
  ),
  SlashCommand(
    label: 'Wikilink', description: 'Link a otra nota ([[...]])',
    icon: Icons.link_rounded, insert: '[[nota]]', cursorOffset: 2,
  ),
  SlashCommand(
    label: 'Fecha', description: 'Insertar fecha actual',
    icon: Icons.today_rounded,
    insert: '__DATE__', // reemplazado por fecha real
    cursorOffset: 10,
  ),
];

/// Abre el slash menu como overlay en [position]. Devuelve el comando
/// seleccionado o null si el usuario cancela (Escape o click fuera).
Future<SlashCommand?> showSlashMenu({
  required BuildContext context,
  required Offset position,
  required String currentFilter,
}) async {
  final filtered = _kCommands
      .where((c) => currentFilter.isEmpty ||
          c.label.toLowerCase().contains(currentFilter.toLowerCase()))
      .toList();
  if (filtered.isEmpty) return null;
  return await showMenu<SlashCommand>(
    context: context,
    position: RelativeRect.fromLTRB(
      position.dx, position.dy, position.dx + 280, position.dy + 400),
    items: filtered.map((c) => PopupMenuItem<SlashCommand>(
      value: c,
      child: Row(
        children: [
          Icon(c.icon, size: 18, color: MxColors.indigoDeep),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(c.label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                Text(c.description, style: const TextStyle(fontSize: 11, color: Colors.grey)),
              ],
            ),
          ),
        ],
      ),
    )).toList(),
  );
}

/// Helper: aplica un comando a un TextEditingController en la posición del cursor.
void applySlashCommand({
  required TextEditingController controller,
  required SlashCommand command,
}) {
  final sel = controller.selection;
  if (!sel.isValid) return;
  final insert = command.insert == '__DATE__'
      ? DateTime.now().toIso8601String().substring(0, 10)
      : command.insert;
  final newText = controller.text.replaceRange(sel.start, sel.end, insert);
  controller.value = TextEditingValue(
    text: newText,
    selection: TextSelection.collapsed(offset: sel.start + command.cursorOffset),
  );
}

/// Helper: detecta "/" al inicio de línea y devuelve la query.
String detectSlashQuery(String text, int cursorPos) {
  if (cursorPos <= 0 || cursorPos > text.length) return '';
  // Busca hacia atrás desde cursor hasta whitespace o inicio.
  int i = cursorPos - 1;
  while (i >= 0 && text[i] != '\n' && text[i] != ' ') i--;
  final token = text.substring(i + 1, cursorPos);
  if (token.startsWith('/')) return token.substring(1);
  return '';
}
