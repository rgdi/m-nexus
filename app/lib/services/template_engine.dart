// template_engine.dart: motor de templates con variables (Templater-style).
//
// v0.60 (P1.8): Obsidian Templater permite templates con JS, variables,
// prompts, fechas, shell exec. Aqui implementamos una version
// simplificada con variables y prompts sin shell exec.
//
// Sintaxis:
//   {{date:YYYY-MM-DD}}           -> fecha actual
//   {{date:YYYY-MM-DD HH:mm}}     -> fecha + hora
//   {{time:HH:mm}}                -> hora actual
//   {{title}}                     -> titulo de la nota (param)
//   {{prompt:label}}              -> pregunta al usuario (modal)
//   {{clipboard}}                 -> contenido del clipboard
//   {{uuid}}                      -> uuid v4
//   {{rand:1-100}}                -> random en rango
//   {{var:name=default}}          -> variable
//   {{daily}}                     -> nombre de daily note (YYYY-MM-DD)
//   {{#each tags}}...{{/each}}    -> loop (simplificado, no implementado)
//
// Ejemplo template:
//   # {{title}}
//   Fecha: {{date:YYYY-MM-DD}}
//   {{prompt:objetivo}}

import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'package:uuid/uuid.dart';
import 'logger.dart';

class TemplateContext {
  final Map<String, String> vars;
  final Future<String?> Function(String prompt) askUser;
  final Future<String?> getClipboard;
  final DateTime Function() now;
  TemplateContext({
    this.vars = const {},
    required this.askUser,
    required this.getClipboard,
    DateTime Function()? now,
  }) : now = now ?? DateTime.now;
}

class TemplateEngine {
  static final _varRe = RegExp(r'\{\{([^{}]+)\}\}');
  final Uuid _uuid = const Uuid();

  /// v0.60 (P1.8): ejecuta un template y devuelve el texto resultante.
  Future<String> render(String template, TemplateContext ctx) async {
    final result = StringBuffer();
    var lastEnd = 0;
    for (final m in _varRe.allMatches(template)) {
      result.write(template.substring(lastEnd, m.start));
      final expr = m.group(1)!.trim();
      try {
        final value = await _eval(expr, ctx);
        result.write(value);
      } catch (e) {
        AdvancedLogger.instance.warn('template', 'eval failed', context: {
          'expr': expr, 'err': e.toString(),
        });
        result.write('{{ERROR:$expr}}');
      }
      lastEnd = m.end;
    }
    result.write(template.substring(lastEnd));
    return result.toString();
  }

  /// v0.60 (P1.8): evalua una expresion individual.
  Future<String> _eval(String expr, TemplateContext ctx) async {
    // Split por ':' para funciones con args
    final parts = expr.split(':');
    final fn = parts[0].trim();
    final arg = parts.length > 1 ? parts.sublist(1).join(':').trim() : null;
    switch (fn) {
      case 'date':
        return _formatDate(arg ?? 'YYYY-MM-DD', ctx.now());
      case 'time':
        return _formatDate(arg ?? 'HH:mm', ctx.now());
      case 'title':
      case 'name':
        return ctx.vars['title'] ?? ctx.vars['name'] ?? 'Sin titulo';
      case 'uuid':
        return _uuid.v4();
      case 'rand':
        // rand:1-100 o rand:1,100
        if (arg == null) return Random().nextInt(100).toString();
        final match = RegExp(r'^(\d+)[\-,](\d+)$').firstMatch(arg);
        if (match == null) return '0';
        final min = int.parse(match.group(1)!);
        final max = int.parse(match.group(2)!);
        return (min + Random().nextInt(max - min + 1)).toString();
      case 'clipboard':
        return await ctx.getClipboard() ?? '';
      case 'prompt':
        if (arg == null) return '';
        return await ctx.askUser(arg) ?? '';
      case 'daily':
        // daily o daily:note-title-format
        return _formatDate('YYYY-MM-DD', ctx.now());
      default:
        // Variable: var:name o var:name=default
        if (expr.startsWith('var:')) {
          final v = expr.substring(4);
          final eq = v.indexOf('=');
          if (eq >= 0) {
            final name = v.substring(0, eq);
            final def = v.substring(eq + 1);
            return ctx.vars[name] ?? def;
          }
          return ctx.vars[v] ?? '';
        }
        // Variable simple: name
        if (ctx.vars.containsKey(fn)) return ctx.vars[fn]!;
        return '{{UNKNOWN:$expr}}';
    }
  }

  String _formatDate(String fmt, DateTime dt) {
    String pad(int n) => n.toString().padLeft(2, '0');
    return fmt
      .replaceAll('YYYY', dt.year.toString())
      .replaceAll('MM', pad(dt.month))
      .replaceAll('DD', pad(dt.day))
      .replaceAll('HH', pad(dt.hour))
      .replaceAll('mm', pad(dt.minute))
      .replaceAll('ss', pad(dt.second));
  }

  /// v0.60 (P1.8): templates built-in.
  static const builtInTemplates = <String, String>{
    'Daily Note': '''---
type: daily
title: "{{title}}"
date: {{date:YYYY-MM-DD}}
tags: [daily]
---

# {{date:YYYY-MM-DD}}

## 🎯 Prioridad del día
{{prompt:prioridad principal}}

## ✅ Tareas
- [ ] {{prompt:tarea 1}}
- [ ] {{prompt:tarea 2}}
- [ ] {{prompt:tarea 3}}

## 💡 Notas
{{clipboard}}
''',
    'Clase': '''---
type: class
title: "{{title}}"
date: {{date:YYYY-MM-DD}}
subject: {{prompt:asignatura}}
---

# {{title}} - {{date:YYYY-MM-DD}}

## 📚 Tema
{{prompt:tema principal}}

## 📝 Apuntes
{{clipboard}}

## ❓ Dudas
- [ ] {{prompt:primera duda}}
''',
    'Flashcard': '''---
id: {{uuid}}
type: basic
tags: [{{prompt:tag}}]
created: {{date:YYYY-MM-DD}}
---

# {{prompt:pregunta}}

{{prompt:respuesta}}
''',
  };
}
