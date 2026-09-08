// setup_wizard.dart: wizard de configuración inicial (5 pasos).
//
// v0.47.0: wizard limpio, cristal, redondeado, con creación de vault.
//
// Pasos:
//   1. Bienvenida (idioma)
//   2. Vault (crear nuevo O seleccionar existente)
//   3. Permisos (almacenamiento, micro, calendario)
//   4. Apariencia (tema, tamaño texto)
//   5. Listo (resumen + tutorial opcional)

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import '../../core/theme.dart';
import '../../services/logger.dart';
import '../../services/permissions.dart';
import '../../services/vault_service.dart';
import '../../utils/safe_call.dart';
import 'onboarding_tutorial.dart';

class SetupWizard extends StatefulWidget {
  final VoidCallback? onComplete;
  const SetupWizard({super.key, this.onComplete});
  @override
  State<SetupWizard> createState() => _SetupWizardState();
}

class _SetupWizardState extends State<SetupWizard> {
  int _step = 0;
  final _vaultNameController = TextEditingController(text: 'Mi Vault');
  String? _selectedVaultPath;
  bool _isCreatingVault = true;
  bool _permStorage = false;
  bool _permMicro = false;
  bool _permCalendar = false;
  String _themeMode = 'system';
  double _fontScale = 1.0;

  final _pageController = PageController();
  bool _saving = false;

  @override
  void dispose() {
    _vaultNameController.dispose();
    _pageController.dispose();
    super.dispose();
  }

  Future<void> _next() async {
    if (_step < 4) {
      setState(() => _step++);
      await _pageController.animateToPage(
        _step,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOutCubic,
      );
    } else {
      await _finish();
    }
  }

  void _back() {
    if (_step > 0) {
      setState(() => _step--);
      _pageController.animateToPage(
        _step,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOutCubic,
      );
    }
  }

  Future<void> _finish() async {
    setState(() => _saving = true);
    final r = await safeCallAsync<void>(
      component: 'setup',
      code: 'EC-SETUP-001',
      message: 'setup wizard save failed',
      category: ErrorCategory.config,
      op: () async {
        // 1. Si eligió crear vault, lo creamos
        if (_isCreatingVault) {
          final docsDir = await getApplicationDocumentsDirectory();
          final vaultDir = Directory(p.join(docsDir.path, _vaultNameController.text.trim()));
          if (!await vaultDir.exists()) {
            await vaultDir.create(recursive: true);
            // Crear estructura inicial
            final notesDir = Directory(p.join(vaultDir.path, 'notes'));
            await notesDir.create();
            final flashcardsDir = Directory(p.join(vaultDir.path, 'flashcards'));
            await flashcardsDir.create();
            // README de bienvenida
            final readme = File(p.join(vaultDir.path, 'README.md'));
            await readme.writeAsString('''# ${_vaultNameController.text.trim()}

Bienvenido a tu vault. Aquí guardas tus notas y flashcards.

## Estructura

- `notes/`: tus notas en markdown
- `flashcards/`: tus flashcards
- `*.md`: archivos sueltos

## Ejemplo

Crea una nota en `notes/anatomia.md` con:

```markdown
# Diafragma

El {{c1::diafragma}} es un músculo en forma de cúpula.
```

Eso crea automáticamente una flashcard cloze.

## Wikilinks

Usa `[[Nota]]` para enlazar: [[anatomia]]

¡Feliz estudio!
''');
          }
          _selectedVaultPath = vaultDir.path;
        }

        // 2. Guardar settings
        // (esto se hace en settings_service por separado)

        // 3. Marcar setup completo
        // (esto lo hace el parent al cerrar el wizard)
      },
    );
    if (!r.success) {
      setState(() => _saving = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: ${r.error?.message ?? 'unknown'}')),
        );
      }
      return;
    }
    if (mounted) {
      if (widget.onComplete != null) {
        widget.onComplete!();
      } else {
        Navigator.of(context).pop(_selectedVaultPath);
      }
    }
  }

  Future<void> _requestPerms() async {
    final storageGranted = await PermissionsService.requestStorage();
    final microGranted = await PermissionsService.requestMicrophone();
    final calendarGranted = await PermissionsService.requestCalendar();
    setState(() {
      _permStorage = storageGranted;
      _permMicro = microGranted;
      _permCalendar = calendarGranted;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // Progress
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
              child: Row(
                children: List.generate(5, (i) {
                  final active = i <= _step;
                  return Expanded(
                    child: Container(
                      margin: const EdgeInsets.symmetric(horizontal: 3),
                      height: 4,
                      decoration: BoxDecoration(
                        color: active
                            ? theme.colorScheme.primary
                            : theme.colorScheme.surfaceContainerHigh,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  );
                }),
              ),
            ),

            // Content
            Expanded(
              child: PageView(
                controller: _pageController,
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  _stepWelcome(),
                  _stepVault(),
                  _stepPermissions(),
                  _stepAppearance(),
                  _stepReady(),
                ],
              ),
            ),

            // Navigation
            Padding(
              padding: const EdgeInsets.all(20),
              child: Row(
                children: [
                  if (_step > 0)
                    TextButton(
                      onPressed: _saving ? null : _back,
                      child: const Text('Atrás'),
                    ),
                  const Spacer(),
                  FilledButton(
                    onPressed: _saving ? null : _next,
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(120, 48),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    child: _saving
                        ? const SizedBox(
                            width: 16, height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : Text(_step < 4 ? 'Siguiente' : 'Empezar'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _stepWelcome() {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          // Logo con efecto cristal
          Container(
            width: 96, height: 96,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  theme.colorScheme.primary,
                  theme.colorScheme.primary.withValues(alpha: 0.6),
                ],
              ),
              borderRadius: BorderRadius.circular(24),
              boxShadow: [
                BoxShadow(
                  color: theme.colorScheme.primary.withValues(alpha: 0.3),
                  blurRadius: 20,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: const Icon(Icons.school_outlined, size: 48, color: Colors.white),
          ),
          const SizedBox(height: 32),
          Text(
            'Bienvenido a M-NEXUS',
            style: theme.textTheme.headlineLarge?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'Tu segundo cerebro digital para estudio médico. Vamos a configurarlo en 5 pasos.',
            style: theme.textTheme.bodyLarge?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 32),
          _BulletPoint(
            icon: Icons.folder_outlined,
            title: 'Vault local',
            subtitle: 'Tus notas en markdown, en tu dispositivo',
          ),
          _BulletPoint(
            icon: Icons.style_outlined,
            title: 'Flashcards con FSRS',
            subtitle: 'Algoritmo de repetición espaciada de Anki',
          ),
          _BulletPoint(
            icon: Icons.bolt_outlined,
            title: 'Offline-first',
            subtitle: 'Funciona sin internet',
          ),
        ],
      ),
    );
  }

  Widget _stepVault() {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('¿Dónde guardamos tus notas?',
              style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Text('Crea un vault nuevo o selecciona uno existente.',
              style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant)),
          const SizedBox(height: 24),
          // Selector: crear vs seleccionar
          Row(
            children: [
              Expanded(child: _VaultOption(
                selected: _isCreatingVault,
                icon: Icons.add_circle_outline,
                title: 'Crear nuevo',
                subtitle: 'Empezar desde cero',
                onTap: () => setState(() => _isCreatingVault = true),
              )),
              const SizedBox(width: 12),
              Expanded(child: _VaultOption(
                selected: !_isCreatingVault,
                icon: Icons.folder_open,
                title: 'Seleccionar',
                subtitle: 'Vault existente',
                onTap: () => setState(() => _isCreatingVault = false),
              )),
            ],
          ),
          const SizedBox(height: 24),
          if (_isCreatingVault) ...[
            Text('Nombre del vault', style: theme.textTheme.labelLarge),
            const SizedBox(height: 8),
            TextField(
              controller: _vaultNameController,
              decoration: InputDecoration(
                hintText: 'Mi Vault',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                prefixIcon: const Icon(Icons.folder_outlined),
              ),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerLow,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  Icon(Icons.info_outline,
                      size: 16, color: theme.colorScheme.onSurfaceVariant),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Se creará en: Documents/${_vaultNameController.text}',
                      style: theme.textTheme.bodySmall,
                    ),
                  ),
                ],
              ),
            ),
          ] else ...[
            Text('Vaults detectados', style: theme.textTheme.labelLarge),
            const SizedBox(height: 8),
            // Lista de vaults detectados
            Expanded(
              child: _DetectedVaultsList(
                onSelect: (path) => setState(() => _selectedVaultPath = path),
                selected: _selectedVaultPath,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _stepPermissions() {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Permisos', style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Text('Otorga los permisos que necesites. Puedes cambiarlos después.',
              style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant)),
          const SizedBox(height: 24),
          _PermCard(
            icon: Icons.folder_outlined,
            title: 'Almacenamiento',
            subtitle: 'Para leer y escribir notas en tu vault',
            granted: _permStorage,
            onRequest: () async {
              final ok = await PermissionsService.requestStorage();
              setState(() => _permStorage = ok);
            },
          ),
          const SizedBox(height: 12),
          _PermCard(
            icon: Icons.mic_outlined,
            title: 'Micrófono',
            subtitle: 'Para grabar notas de voz',
            granted: _permMicro,
            onRequest: () async {
              final ok = await PermissionsService.requestMicrophone();
              setState(() => _permMicro = ok);
            },
          ),
          const SizedBox(height: 12),
          _PermCard(
            icon: Icons.event_outlined,
            title: 'Calendario',
            subtitle: 'Para vincular repasos a eventos',
            granted: _permCalendar,
            onRequest: () async {
              final ok = await PermissionsService.requestCalendar();
              setState(() => _permCalendar = ok);
            },
          ),
          const Spacer(),
          OutlinedButton.icon(
            onPressed: _requestPerms,
            icon: const Icon(Icons.check_circle_outline),
            label: const Text('Solicitar todos'),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _stepAppearance() {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Apariencia', style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Text('Personaliza cómo se ve M-NEXUS.',
              style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant)),
          const SizedBox(height: 24),
          Text('Tema', style: theme.textTheme.labelLarge),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(child: _ThemeOption(
                selected: _themeMode == 'system',
                icon: Icons.brightness_auto,
                label: 'Sistema',
                onTap: () => setState(() => _themeMode = 'system'),
              )),
              const SizedBox(width: 8),
              Expanded(child: _ThemeOption(
                selected: _themeMode == 'light',
                icon: Icons.light_mode,
                label: 'Claro',
                onTap: () => setState(() => _themeMode = 'light'),
              )),
              const SizedBox(width: 8),
              Expanded(child: _ThemeOption(
                selected: _themeMode == 'dark',
                icon: Icons.dark_mode,
                label: 'Oscuro',
                onTap: () => setState(() => _themeMode = 'dark'),
              )),
            ],
          ),
          const SizedBox(height: 24),
          Text('Tamaño de texto: ${(_fontScale * 100).toInt()}%',
              style: theme.textTheme.labelLarge),
          Slider(
            value: _fontScale,
            min: 0.85,
            max: 1.30,
            divisions: 4,
            label: '${(_fontScale * 100).toInt()}%',
            onChanged: (v) => setState(() => _fontScale = v),
          ),
          const SizedBox(height: 24),
          // Preview
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerLow,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Vista previa', style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                )),
                const SizedBox(height: 8),
                Text('El diafragma es un músculo en forma de cúpula',
                    style: theme.textTheme.bodyLarge),
                const SizedBox(height: 8),
                Text('Códigos EC-{{c1::FSRS-5}}',
                    style: theme.textTheme.bodySmall),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _stepReady() {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 96, height: 96,
            decoration: BoxDecoration(
              color: theme.colorScheme.primaryContainer,
              borderRadius: BorderRadius.circular(24),
            ),
            child: Icon(Icons.check_circle_outline,
                size: 48, color: theme.colorScheme.primary),
          ),
          const SizedBox(height: 32),
          Text('¡Todo listo!',
              style: theme.textTheme.headlineLarge?.copyWith(
                fontWeight: FontWeight.w700,
              )),
          const SizedBox(height: 12),
          Text(
            _isCreatingVault
                ? 'Vault "${_vaultNameController.text}" creado. Empezamos.'
                : 'Vault seleccionado. Empezamos.',
            style: theme.textTheme.bodyLarge?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 32),
          _SummaryRow(icon: Icons.folder, label: 'Vault', value: _vaultNameController.text),
          _SummaryRow(
            icon: _themeMode == 'system' ? Icons.brightness_auto
                : _themeMode == 'light' ? Icons.light_mode : Icons.dark_mode,
            label: 'Tema',
            value: _themeMode == 'system' ? 'Sistema' : (_themeMode == 'light' ? 'Claro' : 'Oscuro'),
          ),
          _SummaryRow(
            icon: Icons.text_fields,
            label: 'Tamaño texto',
            value: '${(_fontScale * 100).toInt()}%',
          ),
        ],
      ),
    );
  }
}

class _BulletPoint extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  const _BulletPoint({required this.icon, required this.title, required this.subtitle});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        children: [
          Container(
            width: 40, height: 40,
            decoration: BoxDecoration(
              color: theme.colorScheme.primaryContainer,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 20, color: theme.colorScheme.primary),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w600,
                )),
                Text(subtitle, style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                )),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _VaultOption extends StatelessWidget {
  final bool selected;
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  const _VaultOption({required this.selected, required this.icon, required this.title, required this.subtitle, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: selected ? theme.colorScheme.primaryContainer : theme.colorScheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected ? theme.colorScheme.primary : theme.colorScheme.outlineVariant,
            width: selected ? 2 : 1,
          ),
        ),
        child: Column(
          children: [
            Icon(icon, size: 32,
                color: selected ? theme.colorScheme.primary : theme.colorScheme.onSurfaceVariant),
            const SizedBox(height: 8),
            Text(title, style: theme.textTheme.titleSmall),
            const SizedBox(height: 4),
            Text(subtitle, style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant)),
          ],
        ),
      ),
    );
  }
}

class _DetectedVaultsList extends StatelessWidget {
  final ValueChanged<String> onSelect;
  final String? selected;
  const _DetectedVaultsList({required this.onSelect, this.selected});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return FutureBuilder<List<DetectedVault>>(
      future: VaultDetector.scan(),
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snap.hasError) {
          return Center(child: Text('Error: ${snap.error}'));
        }
        final vaults = snap.data ?? [];
        if (vaults.isEmpty) {
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.folder_off_outlined, size: 48,
                    color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(height: 12),
                Text('No se detectaron vaults',
                    style: theme.textTheme.bodyMedium),
                const SizedBox(height: 4),
                Text('Vuelve atrás y crea uno nuevo',
                    style: theme.textTheme.bodySmall),
              ],
            ),
          );
        }
        return ListView.builder(
          itemCount: vaults.length,
          itemBuilder: (context, i) {
            final v = vaults[i];
            final isSel = v.path == selected;
            return Card(
              child: ListTile(
                leading: Icon(v.method == 'saf' ? Icons.folder_shared : Icons.folder),
                title: Text(v.name),
                subtitle: Text(v.path, maxLines: 1, overflow: TextOverflow.ellipsis),
                trailing: isSel ? Icon(Icons.check_circle, color: theme.colorScheme.primary) : null,
                onTap: () => onSelect(v.path),
              ),
            );
          },
        );
      },
    );
  }
}

class _PermCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final bool granted;
  final VoidCallback onRequest;
  const _PermCard({required this.icon, required this.title, required this.subtitle, required this.granted, required this.onRequest});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.colorScheme.outlineVariant),
      ),
      child: Row(
        children: [
          Container(
            width: 40, height: 40,
            decoration: BoxDecoration(
              color: granted ? theme.colorScheme.primaryContainer : theme.colorScheme.surfaceContainerHigh,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: granted ? theme.colorScheme.primary : theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: theme.textTheme.titleSmall),
                Text(subtitle, style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant)),
              ],
            ),
          ),
          if (granted)
            Icon(Icons.check_circle, color: theme.colorScheme.primary)
          else
            TextButton(
              onPressed: onRequest,
              child: const Text('Permitir'),
            ),
        ],
      ),
    );
  }
}

class _ThemeOption extends StatelessWidget {
  final bool selected;
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _ThemeOption({required this.selected, required this.icon, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: selected ? theme.colorScheme.primaryContainer : theme.colorScheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected ? theme.colorScheme.primary : theme.colorScheme.outlineVariant,
            width: selected ? 2 : 1,
          ),
        ),
        child: Column(
          children: [
            Icon(icon, color: selected ? theme.colorScheme.primary : theme.colorScheme.onSurfaceVariant),
            const SizedBox(height: 4),
            Text(label, style: theme.textTheme.bodySmall),
          ],
        ),
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  const _SummaryRow({required this.icon, required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(icon, size: 18, color: theme.colorScheme.onSurfaceVariant),
          const SizedBox(width: 12),
          Text(label, style: theme.textTheme.bodyMedium),
          const Spacer(),
          Text(value, style: theme.textTheme.bodyMedium?.copyWith(
            fontWeight: FontWeight.w600,
          )),
        ],
      ),
    );
  }
}
