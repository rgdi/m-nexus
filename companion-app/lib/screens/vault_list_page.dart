// VaultListPage: hub para elegir vault. Tapping abre el browser.

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../services/vault_detector.dart' show VaultInfo;
import '../services/vault_detector.dart';
import '../ui/vault_browser_page.dart';

class VaultListPage extends StatefulWidget {
  const VaultListPage({super.key});

  @override
  State<VaultListPage> createState() => _VaultListPageState();
}

class _VaultListPageState extends State<VaultListPage> {
  final _detector = VaultDetector();
  List<VaultInfo> _vaults = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; });
    final vaults = await _detector.detectVaults();
    if (!mounted) return;
    setState(() {
      _vaults = vaults;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Vaults')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _vaults.isEmpty
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.folder_off, size: 64, color: Colors.grey),
                      const SizedBox(height: 16),
                      const Text('No se detectaron vaults'),
                      const SizedBox(height: 8),
                      if (kIsWeb)
                        const Text('Usá la app Android para configurar vaults',
                          style: TextStyle(color: Colors.grey, fontSize: 12))
                      else
                        FilledButton.icon(
                          onPressed: () {/* TODO: show add vault */},
                          icon: const Icon(Icons.add),
                          label: const Text('Añadir'),
                        ),
                    ],
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    for (final v in _vaults) _VaultCard(
                      vault: v,
                      onOpen: () => Navigator.push(
                        context,
                        MaterialPageRoute(builder: (_) => VaultBrowserPage(vaultPath: v.path)),
                      ),
                    ),
                  ],
                ),
    );
  }
}

class _VaultCard extends StatelessWidget {
  final VaultInfo vault;
  final VoidCallback onOpen;
  const _VaultCard({required this.vault, required this.onOpen});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: vault.installedPluginVersion != null
              ? Colors.green.shade100
              : Theme.of(context).colorScheme.surfaceContainerHighest,
          child: Icon(
            vault.installedPluginVersion != null
                ? Icons.check_circle
                : Icons.folder,
            color: vault.installedPluginVersion != null ? Colors.green : null,
          ),
        ),
        title: Text(vault.name),
        subtitle: Text(vault.path, style: const TextStyle(fontSize: 11)),
        trailing: const Icon(Icons.arrow_forward_ios, size: 14),
        onTap: onOpen,
      ),
    );
  }
}
