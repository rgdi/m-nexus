// ActivatePluginPage: instrucciones para activar el plugin M-NEXUS en Obsidian.
//
// v0.31: reemplaza la página "InstallPage" genérica con pasos específicos para
// que el usuario active el plugin en Obsidian (Settings → Community plugins → Enable).
//
// Pasos:
// 1. Abrir Obsidian
// 2. Settings → Community plugins
// 3. Si pide "Restricted mode", desactivarlo
// 4. Buscar "M-NEXUS" en la lista
// 5. Toggle ON
// 6. Volver a esta app para verificar

import 'package:flutter/material.dart';

class ActivatePluginPage extends StatefulWidget {
  const ActivatePluginPage({super.key});

  @override
  State<ActivatePluginPage> createState() => _ActivatePluginPageState();
}

class _ActivatePluginPageState extends State<ActivatePluginPage> {
  int _step = 0;
  static const _totalSteps = 6;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Activar plugin en Obsidian'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(8),
          child: LinearProgressIndicator(
            value: (_step + 1) / _totalSteps,
            backgroundColor: Colors.grey.withOpacity(0.2),
          ),
        ),
      ),
      body: PageView(
        controller: PageController(initialPage: _step),
        physics: const NeverScrollableScrollPhysics(),
        children: [
          _buildStep1(),
          _buildStep2(),
          _buildStep3(),
          _buildStep4(),
          _buildStep5(),
          _buildStep6(),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              if (_step > 0)
                TextButton(onPressed: _prev, child: const Text('Atrás'))
              else
                const SizedBox.shrink(),
              const Spacer(),
              FilledButton(
                onPressed: _next,
                child: Text(_step == _totalSteps - 1 ? 'Finalizar' : 'Siguiente'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _prev() => setState(() => _step = (_step - 1).clamp(0, _totalSteps - 1));
  void _next() {
    if (_step == _totalSteps - 1) {
      Navigator.of(context).pop(true);
      return;
    }
    setState(() => _step = (_step + 1).clamp(0, _totalSteps - 1));
  }

  Widget _buildStepHeader(int num, String title, String subtitle) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                backgroundColor: Theme.of(context).colorScheme.primary,
                child: Text('$num', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(subtitle, style: const TextStyle(color: Colors.grey)),
        ],
      ),
    );
  }

  Widget _buildStep1() {
    return ListView(
      children: [
        _buildStepHeader(1, 'Abre Obsidian', 'Necesitas tener Obsidian instalado y al menos un vault creado.'),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Instruction('• Si no tienes Obsidian, descárgalo de obsidian.md'),
              _Instruction('• Abre Obsidian y selecciona (o crea) un vault'),
              _Instruction('• El plugin M-NEXUS ya está instalado en tu vault por esta app'),
            ],
          ),
        ),
        const SizedBox(height: 24),
        Center(
          child: Icon(Icons.book, size: 96, color: Theme.of(context).colorScheme.primary),
        ),
      ],
    );
  }

  Widget _buildStep2() {
    return ListView(
      children: [
        _buildStepHeader(2, 'Abre Settings', 'Haz clic en el engranaje ⚙️ abajo a la izquierda de Obsidian.'),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Instruction('• En la barra lateral izquierda, busca el ícono de engranaje'),
              _Instruction('• También puedes usar Ctrl+, (Cmd+, en Mac)'),
              _Instruction('• Esto abre la configuración de Obsidian'),
            ],
          ),
        ),
        const SizedBox(height: 24),
        Center(
          child: Icon(Icons.settings, size: 96, color: Theme.of(context).colorScheme.primary),
        ),
      ],
    );
  }

  Widget _buildStep3() {
    return ListView(
      children: [
        _buildStepHeader(3, 'Community plugins', 'En el menú lateral de Settings, selecciona "Community plugins".'),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Instruction('• Si aparece un botón "Turn off Restricted mode", haz clic en él'),
              _Instruction('• Esto es necesario para cargar plugins de la comunidad'),
              _Instruction('• Acepta el diálogo de confirmación'),
            ],
          ),
        ),
        const SizedBox(height: 24),
        Center(
          child: Icon(Icons.extension, size: 96, color: Theme.of(context).colorScheme.primary),
        ),
      ],
    );
  }

  Widget _buildStep4() {
    return ListView(
      children: [
        _buildStepHeader(4, 'Busca M-NEXUS', 'M-NEXUS ya está instalado en tu vault, solo necesitas activarlo.'),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Instruction('• En "Installed plugins" busca "m-nexus"'),
              _Instruction('• Si no aparece, revisa la instalación desde el home'),
              _Instruction('• Toca el nombre del plugin para ver detalles'),
            ],
          ),
        ),
        const SizedBox(height: 24),
        Card(
          margin: const EdgeInsets.symmetric(horizontal: 24),
          child: ListTile(
            leading: const Icon(Icons.medical_services, color: Colors.blue),
            title: const Text('M-NEXUS'),
            subtitle: const Text('Sistema de estudio médico'),
            trailing: Switch(value: true, onChanged: null),
          ),
        ),
      ],
    );
  }

  Widget _buildStep5() {
    return ListView(
      children: [
        _buildStepHeader(5, 'Activa el plugin', 'Toggle el switch para activar M-NEXUS.'),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Instruction('• El switch debería estar a la derecha (azul) cuando esté activo'),
              _Instruction('• Si no estaba, tócalo para activarlo'),
              _Instruction('• Verás un mensaje de confirmación en la parte inferior'),
              _Instruction('• Si pide permisos (almacenamiento, red), acéptalos'),
            ],
          ),
        ),
        const SizedBox(height: 24),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 24),
          child: Card(
            color: Color(0xFFE0F2FE),
            child: ListTile(
              leading: Icon(Icons.check_circle, color: Colors.green),
              title: Text('M-NEXUS activado'),
              subtitle: Text('Listo para usar'),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildStep6() {
    return ListView(
      children: [
        _buildStepHeader(6, '¡Listo!', 'Vuelve a esta app para verificar la activación.'),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Instruction('• En Obsidian deberías ver el ribbon (iconos) con M-NEXUS'),
              _Instruction('• También puedes abrir un comando (Ctrl+P) y escribir "M-NEXUS"'),
              _Instruction('• Para grabar una clase, vuelve a esta app y usa el botón de micrófono'),
              _Instruction('• El backend se conectará automáticamente'),
            ],
          ),
        ),
        const SizedBox(height: 24),
        Center(
          child: Icon(Icons.celebration, size: 96, color: Colors.green),
        ),
        const SizedBox(height: 16),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 24),
          child: Card(
            child: ListTile(
              leading: Icon(Icons.tips_and_updates, color: Colors.amber),
              title: Text('Tip'),
              subtitle: Text(
                'Si M-NEXUS no aparece en Obsidian, cierra y reabre Obsidian. '
                'Los plugins se cargan al iniciar.',
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _Instruction extends StatelessWidget {
  final String text;
  const _Instruction(this.text);
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Text(text, style: const TextStyle(fontSize: 14)),
    );
  }
}
