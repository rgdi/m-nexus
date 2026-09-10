// ai_settings_screen.dart: configuracion del provider AI multi-modelo.
//
// v0.51: selector de provider (Ollama/OpenAI/Anthropic/OpenRouter/Mock)
// + selector de modelo + API key + test de conexion.

import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../services/multi_model_ai.dart';

class AiSettingsScreen extends StatefulWidget {
  const AiSettingsScreen({super.key});

  @override
  State<AiSettingsScreen> createState() => _AiSettingsScreenState();
}

class _AiSettingsScreenState extends State<AiSettingsScreen> {
  AiConfig _config = AiConfig();
  bool _loading = true;
  String? _testResult;
  bool _testing = false;
  final _apiKeyC = TextEditingController();
  final _baseUrlC = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _apiKeyC.dispose();
    _baseUrlC.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final json = prefs.getString('ai.config');
    if (json != null) {
      try {
        _config = AiConfig.fromJson(jsonDecode(json) as Map<String, dynamic>);
      } catch (_) {}
    }
    _apiKeyC.text = _config.apiKey ?? '';
    _baseUrlC.text = _config.baseUrl;
    if (!mounted) return;
    setState(() => _loading = false);
  }

  Future<void> _save() async {
    _config.apiKey = _apiKeyC.text.trim().isEmpty ? null : _apiKeyC.text.trim();
    _config.baseUrl = _baseUrlC.text.trim();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('ai.config', jsonEncode(_config.toJson()));
    if (!mounted) return;
    setState(() {});
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Configuración guardada')),
    );
  }

  Future<void> _test() async {
    setState(() {
      _testing = true;
      _testResult = null;
    });
    try {
      await _save();
      final ai = MultiModelAi(_config);
      final r = await ai.chat([
        const AiMessage(role: 'user', content: 'Di "OK" si recibes este mensaje.'),
      ]).timeout(const Duration(seconds: 30));
      if (!mounted) return;
      setState(() {
        _testResult = 'OK en ${r.latency.inMilliseconds}ms · ${r.model}';
        _testing = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _testResult = 'Error: $e';
        _testing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Configuración AI')),
      body: _loading
        ? const Center(child: CircularProgressIndicator())
        : ListView(
            padding: const EdgeInsets.all(16),
            children: [
              DropdownButtonFormField<AiProvider>(
                value: _config.provider,
                decoration: const InputDecoration(
                  labelText: 'Provider',
                  border: OutlineInputBorder(),
                ),
                items: AiProvider.values.map((p) => DropdownMenuItem(
                  value: p,
                  child: Text(_providerLabel(p)),
                )).toList(),
                onChanged: (v) {
                  if (v == null) return;
                  setState(() {
                    _config.provider = v;
                    final models = MultiModelAi.modelsFor(v);
                    if (models.isNotEmpty) _config.model = models.first.id;
                    _config.baseUrl = _defaultBaseUrl(v);
                    _baseUrlC.text = _config.baseUrl;
                  });
                },
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: _config.model,
                decoration: const InputDecoration(
                  labelText: 'Modelo',
                  border: OutlineInputBorder(),
                ),
                items: MultiModelAi.modelsFor(_config.provider).map((m) => DropdownMenuItem(
                  value: m.id,
                  child: Text(m.name),
                )).toList(),
                onChanged: (v) {
                  if (v != null) setState(() => _config.model = v);
                },
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _baseUrlC,
                decoration: const InputDecoration(
                  labelText: 'Base URL',
                  border: OutlineInputBorder(),
                ),
                onChanged: (v) => _config.baseUrl = v.trim(),
              ),
              const SizedBox(height: 12),
              if (_config.provider != AiProvider.ollama && _config.provider != AiProvider.mock) ...[
                TextField(
                  controller: _apiKeyC,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'API Key',
                    helperText: 'Se guarda en SharedPreferences del dispositivo.',
                    border: OutlineInputBorder(),
                  ),
                  onChanged: (v) => _config.apiKey = v.trim(),
                ),
                const SizedBox(height: 12),
              ],
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      icon: _testing
                        ? const SizedBox(width: 14, height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Icon(Icons.send),
                      label: const Text('Test conexion'),
                      onPressed: _testing ? null : _test,
                    ),
                  ),
                ],
              ),
              if (_testResult != null) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: _testResult!.startsWith('Error')
                      ? Theme.of(context).colorScheme.errorContainer
                      : Theme.of(context).colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(_testResult!),
                ),
              ],
              const SizedBox(height: 24),
              FilledButton.icon(
                icon: const Icon(Icons.save),
                label: const Text('Guardar configuración'),
                onPressed: _save,
              ),
            ],
          ),
    );
  }

  String _providerLabel(AiProvider p) {
    switch (p) {
      case AiProvider.ollama: return 'Ollama (local)';
      case AiProvider.openai: return 'OpenAI';
      case AiProvider.anthropic: return 'Anthropic';
      case AiProvider.openrouter: return 'OpenRouter';
      case AiProvider.mock: return 'Mock (testing)';
    }
  }

  String _defaultBaseUrl(AiProvider p) {
    switch (p) {
      case AiProvider.ollama: return 'http://localhost:11434';
      case AiProvider.openai: return 'https://api.openai.com';
      case AiProvider.anthropic: return 'https://api.anthropic.com';
      case AiProvider.openrouter: return 'https://openrouter.ai';
      case AiProvider.mock: return '';
    }
  }
}
