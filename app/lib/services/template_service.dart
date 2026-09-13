// template_service.dart — Doc templates locales.
// v0.62.16: AFFiNE tiene template marketplace. M-NEXUS empieza con templates
// locales predefinidos + custom (usuario puede guardar sus propias).

import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;
import 'file_lock.dart';

class DocTemplate {
  final String id;
  final String name;
  final String description;
  final String icon; // emoji o 2 letras
  final String body; // markdown content
  final bool isCustom;

  const DocTemplate({
    required this.id,
    required this.name,
    required this.description,
    required this.icon,
    required this.body,
    this.isCustom = false,
  });

  Map<String, dynamic> toJson() => {
    'id': id, 'name': name, 'description': description, 'icon': icon, 'body': body,
    'isCustom': isCustom,
  };

  factory DocTemplate.fromJson(Map<String, dynamic> j) => DocTemplate(
    id: j['id'] as String,
    name: j['name'] as String,
    description: (j['description'] as String?) ?? '',
    icon: (j['icon'] as String?) ?? '📄',
    body: (j['body'] as String?) ?? '',
    isCustom: (j['isCustom'] as bool?) ?? false,
  );
}

/// Templates built-in.
const kBuiltInTemplates = <DocTemplate>[
  DocTemplate(
    id: 'blank', name: 'Nota en blanco', description: 'Página vacía',
    icon: '📄', body: '',
  ),
  DocTemplate(
    id: 'daily', name: 'Daily note', description: 'Nota diaria con secciones',
    icon: '☀️',
    body: '''# \${title}

## 📋 Tareas
- [ ]

## 📝 Notas


## 💡 Ideas


## 🎴 Para repasar

''',
  ),
  DocTemplate(
    id: 'meeting', name: 'Reunión', description: 'Notas de meeting con agenda',
    icon: '🤝',
    body: '''# \${title}

**Fecha:** \${date}
**Asistentes:** 

## 🎯 Agenda

1. 
2. 
3. 

## ✅ Decisiones

- 

## 📌 Action items

- [ ] @persona: tarea

## 📝 Notas

''',
  ),
  DocTemplate(
    id: 'study', name: 'Sesión de estudio', description: 'Apuntes con resumen + flashcards',
    icon: '🎓',
    body: '''# \${title}

## 🎯 Objetivo

## 📚 Conceptos clave

- **Concepto 1:** explicación
- **Concepto 2:** explicación
- **Concepto 3:** explicación

## 🔗 Conexiones

- [[otra nota]] relación
- [[otra nota]] relación

## 🃏 Flashcards

- Q: pregunta?
  A: respuesta
- Q: pregunta?
  A: respuesta

## 📌 Resumen en una frase


''',
  ),
  DocTemplate(
    id: 'project', name: 'Proyecto', description: 'Plan de proyecto',
    icon: '🚀',
    body: '''# \${title}

## 🎯 Objetivo

## 🗓️ Timeline

- [ ] Fase 1: descripción
- [ ] Fase 2: descripción
- [ ] Fase 3: descripción

## 👥 Equipo

- @persona: rol
- @persona: rol

## 📦 Entregables

- 

## ⚠️ Riesgos

- 

''',
  ),
  DocTemplate(
    id: 'review', name: 'Weekly review', description: 'Revisión semanal',
    icon: '📅',
    body: '''# Weekly Review — \${date}

## 🏆 Logros esta semana

- 
- 
- 

## 🚧 Bloqueos

- 

## 📚 Aprendido

- 

## 🎯 Foco próxima semana

- [ ] 
- [ ] 
- [ ] 

## 😊 Wellbeing (1-10)

- Energía: 
- Motivación: 
- Estrés: 

''',
  ),
];

class TemplateService {
  final String vaultPath;
  static const _customFile = 'templates.json';

  TemplateService(this.vaultPath);

  File _customFileHandle() =>
      File(p.join(vaultPath, '_M-NEXUS', _customFile));

  Future<List<DocTemplate>> listAll() async {
    final all = <DocTemplate>[...kBuiltInTemplates];
    try {
      final f = _customFileHandle();
      if (await f.exists()) {
        final raw = await f.readAsString();
        final list = jsonDecode(raw) as List;
        for (final e in list) {
          all.add(DocTemplate.fromJson(e as Map<String, dynamic>));
        }
      }
    } catch (_) {}
    return all;
  }

  Future<void> saveCustom(DocTemplate t) async {
    final customs = await listAll().then((all) =>
        all.where((x) => x.isCustom).toList());
    customs.removeWhere((x) => x.id == t.id);
    customs.add(t.copyWith(isCustom: true));
    final f = _customFileHandle();
    await f.parent.create(recursive: true);
    await FileLock.run(f.path, () async {
      await f.writeAsString(jsonEncode(customs.map((x) => x.toJson()).toList()), flush: true);
    });
  }

  Future<void> deleteCustom(String id) async {
    final customs = await listAll().then((all) =>
        all.where((x) => x.isCustom).toList());
    customs.removeWhere((x) => x.id == id);
    final f = _customFileHandle();
    await FileLock.run(f.path, () async {
      await f.writeAsString(jsonEncode(customs.map((x) => x.toJson()).toList()), flush: true);
    });
  }
}

extension _TemplateCopyWith on DocTemplate {
  DocTemplate copyWith({String? id, String? name, String? description,
      String? icon, String? body, bool? isCustom}) => DocTemplate(
    id: id ?? this.id,
    name: name ?? this.name,
    description: description ?? this.description,
    icon: icon ?? this.icon,
    body: body ?? this.body,
    isCustom: isCustom ?? this.isCustom,
  );
}
