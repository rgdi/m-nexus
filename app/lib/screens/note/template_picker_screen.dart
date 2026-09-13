// template_picker_screen.dart — selector de templates AFFiNE-style.
// v0.62.16: pantalla para elegir un template antes de crear nota.

import 'package:flutter/material.dart';
import '../../core/design_tokens.dart';
import '../../services/template_service.dart';
import '../../widgets/empty_state.dart';
import 'note_editor.dart';

class TemplatePickerScreen extends StatefulWidget {
  final String vaultPath;
  const TemplatePickerScreen({super.key, required this.vaultPath});
  @override
  State<TemplatePickerScreen> createState() => _TemplatePickerScreenState();
}

class _TemplatePickerScreenState extends State<TemplatePickerScreen> {
  late TemplateService _svc;
  List<DocTemplate> _templates = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _svc = TemplateService(widget.vaultPath);
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    _templates = await _svc.listAll();
    if (mounted) setState(() => _loading = false);
  }

  void _pick(DocTemplate t) {
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => NoteEditor(
          vaultPath: widget.vaultPath,
          initialTitle: t.name,
          initialTemplate: t,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(message: 'Cargando templates…');
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Templates', style: TextStyle(fontWeight: FontWeight.w700)),
      ),
      body: _templates.isEmpty
          ? const EmptyState(icon: Icons.folder_outlined, title: 'Sin templates')
          : GridView.builder(
              padding: const EdgeInsets.all(MxSpacing.lg),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                mainAxisSpacing: MxSpacing.md,
                crossAxisSpacing: MxSpacing.md,
                childAspectRatio: 0.95,
              ),
              itemCount: _templates.length,
              itemBuilder: (ctx, i) {
                final t = _templates[i];
                return InkWell(
                  onTap: () => _pick(t),
                  borderRadius: BorderRadius.circular(MxRadius.lg),
                  child: Container(
                    padding: const EdgeInsets.all(MxSpacing.md),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          MxColors.indigoDeep.withOpacity(0.10),
                          MxColors.violet.withOpacity(0.05),
                        ],
                      ),
                      borderRadius: BorderRadius.circular(MxRadius.lg),
                      border: Border.all(color: theme.dividerColor.withOpacity(0.2)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.folder_rounded,
                          size: 32,
                          color: MxColors.indigoDeep,
                        ),
                        const SizedBox(height: MxSpacing.sm),
                        Text(t.name,
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                          maxLines: 2, overflow: TextOverflow.ellipsis),
                        const SizedBox(height: 4),
                        Expanded(
                          child: Text(t.description,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                            maxLines: 3, overflow: TextOverflow.ellipsis),
                        ),
                        if (t.isCustom)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: MxColors.violet.withOpacity(0.15),
                              borderRadius: BorderRadius.circular(MxRadius.pill),
                            ),
                            child: const Text('Custom',
                              style: TextStyle(fontSize: 9, color: MxColors.violet, fontWeight: FontWeight.w700)),
                          ),
                      ],
                    ),
                  ),
                );
              },
            ),
    );
  }
}
