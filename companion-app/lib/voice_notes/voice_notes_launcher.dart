// Launcher widget que pide backendUrl/authToken si no están, luego abre RecordingPage.

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'voice_notes_service.dart';
import 'recording_page.dart';

class VoiceNotesLauncher extends StatefulWidget {
  final String backendUrl;
  final String authToken;
  const VoiceNotesLauncher({required this.backendUrl, required this.authToken});

  @override
  State<VoiceNotesLauncher> createState() => VoiceNotesLauncherState();
}

class VoiceNotesLauncherState extends State<VoiceNotesLauncher> {
  final _urlController = TextEditingController();
  final _tokenController = TextEditingController();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    _urlController.text = prefs.getString('backendUrl') ?? 'https://api.mnexus.app';
    _tokenController.text = prefs.getString('authToken') ?? '';
    if (mounted) setState(() {});
  }

  Future<void> _saveAndOpen() async {
    final url = _urlController.text.trim();
    final token = _tokenController.text.trim();
    if (url.isEmpty || token.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('URL y token son obligatorios')),
      );
      return;
    }
    setState(() => _saving = true);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('backendUrl', url);
    await prefs.setString('authToken', token);
    if (!mounted) return;
    final service = VoiceNotesService(backendUrl: url, authToken: token);
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(builder: (_) => RecordingPage(service: service)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('🎙️ Configurar')),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Conecta con tu backend M-NEXUS para subir grabaciones y recibir transcripciones.',
              style: TextStyle(fontSize: 14),
            ),
            const SizedBox(height: 24),
            TextField(
              controller: _urlController,
              decoration: const InputDecoration(
                labelText: 'URL del backend',
                hintText: 'https://api.mnexus.app',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.cloud),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _tokenController,
              decoration: const InputDecoration(
                labelText: 'Auth token',
                hintText: 'Bearer ...',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.key),
              ),
              obscureText: false,
            ),
            const SizedBox(height: 32),
            FilledButton.icon(
              onPressed: _saving ? null : _saveAndOpen,
              icon: const Icon(Icons.arrow_forward),
              label: const Text('Continuar'),
            ),
          ],
        ),
      ),
    );
  }
}
