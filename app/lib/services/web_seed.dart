// web_seed.dart — seed de notas demo en el vault web.
// v0.62.18: en web, la primera vez que el user abre la app, sembramos 3
// notas de ejemplo para que vea cómo funciona.

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'web_vault_service.dart';

class WebSeed {
  static const _seedFlagKey = 'mnexus_web_seeded_v1';

  static Future<void> ensureSeeded(WebVaultService svc) async {
    if (!kIsWeb) return;
    try {
      // ignore: avoid_web_libraries_in_flutter
      final prefs = await _getPrefs();
      if (prefs.getBool(_seedFlagKey) == true) return;
      final existing = await svc.listAll();
      if (existing.isNotEmpty) {
        await prefs.setBool(_seedFlagKey, true);
        return;
      }
      await svc.writeNote('welcome.md', _welcomeContent);
      await svc.writeNote('getting-started.md', _gettingStartedContent);
      await svc.writeNote('flashcards-demo.md', _flashcardsContent);
      await prefs.setBool(_seedFlagKey, true);
    } catch (_) {}
  }

  static Future<SharedPreferences> _getPrefs() async =>
      await SharedPreferences.getInstance();

  static const String _welcomeContent = '''---
title: Bienvenido a M-NEXUS
type: welcome
---

# ¡Bienvenido a M-NEXUS! 👋

Esta es tu primera nota de ejemplo. M-NEXUS es un **sistema de estudio
médico** local-first: vault markdown, flashcards con FSRS, daily notes,
whiteboards, recording y AI tutor.

## Cómo usar esta versión web

- **Vault** → guarda tus notas markdown. Creadas con la pestaña "+"
- **Tarjetas** → flashcards con repetición espaciada (FSRS-5.4.2)
- **Plan** → exámenes y tareas. Se sincroniza con el calendar del sistema
- **Ajustes** → tema, backend URL, sync entre devices

## Limitaciones de la versión web

- El vault se guarda en `localStorage` del browser (≈5MB)
- La cámara y la grabación de audio no funcionan (son features mobile)
- Las flashcards sí funcionan, sin FSRS de backend

> M-NEXUS es humano-en-el-loop. La IA propone, tú decides.
''';

  static const String _gettingStartedContent = '''---
title: Primeros pasos
type: guide
---

# Primeros pasos

1. Crea tu primera nota con el botón "+" del Home
2. Marca con `#hashtags` para categorizar
3. Usa `[[wikilinks]]` para conectar notas
4. Convierte una línea en cloze flashcard con `{{c1::pregunta::respuesta}}`
5. Revisa con FSRS desde la pestaña Tarjetas

## Markdown cheatsheet

```
# H1 / ## H2 / ### H3
**negrita** *itálica*
- lista
1. numerada
[link](url)
![img](url)
`código`
```lenguaje
código en bloque
```
''';

  static const String _flashcardsContent = '''---
title: Demo flashcards
type: demo
cards:
  - Q: ¿Cuál es la diferencia entre arteria y vena?
    A: Las arterias llevan sangre desde el corazón, las venas al corazón.
  - Q: ¿Qué es el sistema linfático?
    A: Sistema de drenaje que回收 proteínas del espacio intersticial.
---
''';
}

