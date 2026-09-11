// export_service.dart: exporta notas a PDF, HTML y Markdown combinado.
//
// v0.50:
// - exportPdf(notePath) usa el package 'pdf' para generar PDF nativo
// - exportHtml(notePath) genera HTML standalone con estilo
// - exportVaultAsMarkdown() junta todas las notas en un .md unico

import 'dart:io';
import 'package:path/path.dart' as p;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:flutter/services.dart' show rootBundle;
import '../utils/safe_call.dart';
import '../utils/error_codes.dart';
import 'logger.dart';

class ExportService {
  final String vaultPath;
  ExportService(this.vaultPath);

  /// v0.50: exporta una nota a PDF
  /// Retorna el path del PDF generado
  Future<String> exportPdf(String notePath) async {
    final r = await safeCallAsync<String>(
      component: 'export',
      code: 'EC-EXP-001',
      message: 'exportPdf failed',
      category: ErrorCategory.fs,
      context: {'notePath': notePath},
      op: () async {
        final f = File(notePath);
        if (!await f.exists()) throw Exception('Note not found: $notePath');
        final content = await f.readAsString();
        final title = p.basenameWithoutExtension(notePath);
        final parsed = _parseNote(content);

        final pdfDoc = pw.Document(
          title: title,
          author: 'M-NEXUS',
        );

        pdfDoc.addPage(
          pw.MultiPage(
            pageFormat: PdfPageFormat.a4,
            margin: const pw.EdgeInsets.all(40),
            header: (ctx) => pw.Container(
              padding: const pw.EdgeInsets.only(bottom: 8),
              decoration: const pw.BoxDecoration(
                border: pw.Border(bottom: pw.BorderSide(color: PdfColors.grey300, width: 0.5)),
              ),
              child: pw.Row(
                mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                children: [
                  pw.Text(parsed.title, style: pw.TextStyle(fontSize: 10, color: PdfColors.grey700)),
                  pw.Text('M-NEXUS', style: pw.TextStyle(fontSize: 10, color: PdfColors.grey500)),
                ],
              ),
            ),
            footer: (ctx) => pw.Container(
              padding: const pw.EdgeInsets.only(top: 8),
              child: pw.Row(
                mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                children: [
                  pw.Text(DateTime.now().toIso8601String().substring(0, 10),
                    style: pw.TextStyle(fontSize: 9, color: PdfColors.grey500)),
                  pw.Text('Pag ${ctx.pageNumber} / ${ctx.pagesCount}',
                    style: pw.TextStyle(fontSize: 9, color: PdfColors.grey500)),
                ],
              ),
            ),
            build: (ctx) {
              final widgets = <pw.Widget>[];
              if (parsed.frontmatter.isNotEmpty) {
                widgets.add(pw.Container(
                  padding: const pw.EdgeInsets.all(8),
                  margin: const pw.EdgeInsets.only(bottom: 12),
                  decoration: pw.BoxDecoration(
                    color: PdfColors.grey100,
                    borderRadius: pw.BorderRadius.circular(4),
                  ),
                  child: pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.start,
                    children: parsed.frontmatter.entries.map((e) => pw.Text(
                      '${e.key}: ${e.value}',
                      style: pw.TextStyle(fontSize: 9, color: PdfColors.grey800),
                    )).toList(),
                  ),
                ));
              }
              for (final block in parsed.blocks) {
                widgets.add(_blockToPdf(block));
                widgets.add(pw.SizedBox(height: 4));
              }
              return widgets;
            },
          ),
        );

        final dir = Directory(p.join(vaultPath, 'Exports'));
        if (!await dir.exists()) await dir.create(recursive: true);
        final outPath = p.join(dir.path, '$title.pdf');
        final file = File(outPath);
        await file.writeAsBytes(await pdfDoc.save());
        AdvancedLogger.instance.info('export', 'pdf saved', context: {'path': outPath});
        return outPath;
      },
    );
    if (!r.success) throw r.error!;
    return r.value!;
  }

  /// v0.50: exporta una nota a HTML standalone
  Future<String> exportHtml(String notePath) async {
    final f = File(notePath);
    if (!await f.exists()) throw Exception('Note not found: $notePath');
    final content = await f.readAsString();
    final title = p.basenameWithoutExtension(notePath);
    final parsed = _parseNote(content);
    final htmlBody = _blocksToHtml(parsed.blocks);
    final fmTable = parsed.frontmatter.entries.map((e) =>
      '<tr><th>${_htmlEsc(e.key)}</th><td>${_htmlEsc(e.value)}</td></tr>'
    ).join('\n');
    final html = '''<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${_htmlEsc(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         max-width: 800px; margin: 2em auto; padding: 0 1em;
         line-height: 1.6; color: #222; }
  h1, h2, h3 { line-height: 1.2; }
  h1 { border-bottom: 2px solid #222; padding-bottom: 0.2em; }
  h2 { border-bottom: 1px solid #ccc; padding-bottom: 0.1em; margin-top: 1.5em; }
  code { background: #f4f4f4; padding: 0.1em 0.3em; border-radius: 3px; font-family: monospace; }
  pre { background: #1e1e1e; color: #fff; padding: 1em; border-radius: 4px; overflow-x: auto; }
  pre code { background: transparent; color: #fff; }
  blockquote { border-left: 4px solid #1976d2; padding: 0.5em 1em; color: #555; margin: 1em 0; }
  .callout { background: #fff3e0; border: 1px solid #ffb300; padding: 0.5em 1em; border-radius: 4px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 0.4em 0.8em; }
  th { background: #f4f4f4; }
  .frontmatter { background: #f8f8f8; border: 1px solid #ddd; padding: 1em; border-radius: 4px; margin-bottom: 1em; }
  hr { border: none; border-top: 1px solid #ccc; margin: 2em 0; }
  .todo { display: flex; align-items: center; gap: 0.5em; }
  .todo input { margin: 0; }
</style>
</head>
<body>
<div class="frontmatter">
  <h1 style="margin-top:0">${_htmlEsc(title)}</h1>
  <table>${fmTable.isEmpty ? '' : '<tr><th>Clave</th><th>Valor</th></tr>\n$fmTable'}</table>
</div>
$htmlBody
<hr>
<footer style="text-align:center;color:#888;font-size:0.85em">
  Exportado desde <a href="https://github.com/rgdi/m-nexus">M-NEXUS</a> · ${DateTime.now().toIso8601String().substring(0, 10)}
</footer>
</body>
</html>''';
    final dir = Directory(p.join(vaultPath, 'Exports'));
    if (!await dir.exists()) await dir.create(recursive: true);
    final outPath = p.join(dir.path, '$title.html');
    await File(outPath).writeAsString(html);
    return outPath;
  }

  /// v0.50: exporta todo el vault a un unico Markdown
  /// Cada nota se incluye como seccion
  Future<String> exportVaultAsMarkdown() async {
    final root = Directory(vaultPath);
    if (!await root.exists()) throw Exception('Vault not found');
    final buf = StringBuffer();
    buf.writeln('# M-NEXUS Vault Export');
    buf.writeln();
    buf.writeln('Exportado: ${DateTime.now().toIso8601String()}');
    buf.writeln();
    buf.writeln('---');
    buf.writeln();

    await for (final entity in root.list(recursive: true, followLinks: false)) {
      if (entity is! File || !entity.path.endsWith('.md')) continue;
      // Saltar dotfiles
      if (p.basename(entity.path).startsWith('.')) continue;
      try {
        final rel = p.relative(entity.path, from: vaultPath);
        buf.writeln('## $rel');
        buf.writeln();
        buf.writeln(await entity.readAsString());
        buf.writeln();
        buf.writeln('---');
        buf.writeln();
      } catch (_) {}
    }
    final dir = Directory(p.join(vaultPath, 'Exports'));
    if (!await dir.exists()) await dir.create(recursive: true);
    final outPath = p.join(dir.path, 'vault-export-${DateTime.now().millisecondsSinceEpoch}.md');
    await File(outPath).writeAsString(buf.toString());
    return outPath;
  }

  // v0.50: parser simple frontmatter + blocks
  _ParsedNote _parseNote(String content) {
    final fm = <String, String>{};
    var body = content;
    if (content.startsWith('---')) {
      final end = content.indexOf('---', 3);
      if (end > 0) {
        final fmBody = content.substring(3, end).trim();
        for (final line in fmBody.split('\n')) {
          final idx = line.indexOf(':');
          if (idx > 0) {
            fm[line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
          }
        }
        body = content.substring(end + 3).trim();
      }
    }
    return _ParsedNote(
      title: fm['title'] ?? 'Sin título',
      frontmatter: fm,
      blocks: _markdownToBlocks(body),
    );
  }

  List<_Block> _markdownToBlocks(String md) {
    final out = <_Block>[];
    final lines = md.split('\n');
    int i = 0;
    while (i < lines.length) {
      final l = lines[i];
      if (l.isEmpty) { i++; continue; }
      _Block? block;
      if (l.startsWith('# ')) block = _Block(type: 'h1', text: l.substring(2));
      else if (l.startsWith('## ')) block = _Block(type: 'h2', text: l.substring(3));
      else if (l.startsWith('### ')) block = _Block(type: 'h3', text: l.substring(4));
      else if (l.startsWith('```')) {
        final code = StringBuffer();
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          code.writeln(lines[i]);
          i++;
        }
        block = _Block(type: 'code', text: code.toString().trimRight());
      } else if (l.trim() == '---') block = _Block(type: 'hr', text: '');
      else if (l.startsWith('> ')) block = _Block(type: 'quote', text: l.substring(2));
      else if (l.startsWith('- [ ] ')) block = _Block(type: 'todo', text: l.substring(6), checked: false);
      else if (l.startsWith('- [x] ')) block = _Block(type: 'todo', text: l.substring(6), checked: true);
      else if (l.startsWith('- ') || l.startsWith('* ')) block = _Block(type: 'bullet', text: l.substring(2));
      else if (RegExp(r'^\d+\. ').hasMatch(l)) block = _Block(type: 'numbered', text: l.replaceFirst(RegExp(r'^\d+\. '), ''));
      else block = _Block(type: 'p', text: l);
      if (block != null) out.add(block);
      i++;
    }
    return out;
  }

  pw.Widget _blockToPdf(_Block b) {
    switch (b.type) {
      case 'h1': return pw.Padding(
        padding: const pw.EdgeInsets.only(top: 12, bottom: 6),
        child: pw.Text(b.text, style: pw.TextStyle(fontSize: 22, fontWeight: pw.FontWeight.bold)),
      );
      case 'h2': return pw.Padding(
        padding: const pw.EdgeInsets.only(top: 10, bottom: 4),
        child: pw.Text(b.text, style: pw.TextStyle(fontSize: 18, fontWeight: pw.FontWeight.bold)),
      );
      case 'h3': return pw.Padding(
        padding: const pw.EdgeInsets.only(top: 8, bottom: 4),
        child: pw.Text(b.text, style: pw.TextStyle(fontSize: 14, fontWeight: pw.FontWeight.bold)),
      );
      case 'p': return pw.Padding(
        padding: const pw.EdgeInsets.symmetric(vertical: 2),
        child: pw.Text(b.text, style: const pw.TextStyle(fontSize: 11, lineSpacing: 1.4)),
      );
      case 'code': return pw.Container(
        width: double.infinity,
        padding: const pw.EdgeInsets.all(8),
        decoration: pw.BoxDecoration(
          color: PdfColors.grey900,
          borderRadius: pw.BorderRadius.circular(4),
        ),
        child: pw.Text(b.text,
          style: pw.TextStyle(fontSize: 9, font: null, color: PdfColors.white)),
      );
      case 'quote': return pw.Container(
        width: double.infinity,
        padding: const pw.EdgeInsets.fromLTRB(12, 6, 6, 6),
        decoration: const pw.BoxDecoration(
          border: pw.Border(left: pw.BorderSide(color: PdfColors.blue700, width: 3)),
        ),
        child: pw.Text(b.text, style: const pw.TextStyle(fontSize: 11, color: PdfColors.grey800)),
      );
      case 'hr': return pw.Padding(
        padding: const pw.EdgeInsets.symmetric(vertical: 8),
        child: pw.Divider(color: PdfColors.grey400),
      );
      case 'bullet': return pw.Padding(
        padding: const pw.EdgeInsets.only(left: 12, top: 1, bottom: 1),
        child: pw.Row(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Text('• ', style: const pw.TextStyle(fontSize: 11)),
            pw.Expanded(child: pw.Text(b.text, style: const pw.TextStyle(fontSize: 11))),
          ],
        ),
      );
      case 'todo': return pw.Padding(
        padding: const pw.EdgeInsets.only(left: 8, top: 1, bottom: 1),
        child: pw.Row(
          children: [
            pw.Text(b.checked ? '☑ ' : '☐ ', style: const pw.TextStyle(fontSize: 11)),
            pw.Expanded(child: pw.Text(b.text, style: const pw.TextStyle(fontSize: 11))),
          ],
        ),
      );
      case 'numbered': return pw.Padding(
        padding: const pw.EdgeInsets.only(left: 12, top: 1, bottom: 1),
        child: pw.Text('• ${b.text}', style: const pw.TextStyle(fontSize: 11)),
      );
      default: return pw.Text(b.text, style: const pw.TextStyle(fontSize: 11));
    }
  }

  String _blocksToHtml(List<_Block> blocks) {
    final buf = StringBuffer();
    for (final b in blocks) {
      switch (b.type) {
        case 'h1': buf.writeln('<h1>${_htmlEsc(b.text)}</h1>'); break;
        case 'h2': buf.writeln('<h2>${_htmlEsc(b.text)}</h2>'); break;
        case 'h3': buf.writeln('<h3>${_htmlEsc(b.text)}</h3>'); break;
        case 'p': buf.writeln('<p>${_mdInlineToHtml(b.text)}</p>'); break;
        case 'code': buf.writeln('<pre><code>${_htmlEsc(b.text)}</code></pre>'); break;
        case 'quote': buf.writeln('<blockquote>${_htmlEsc(b.text)}</blockquote>'); break;
        case 'hr': buf.writeln('<hr>'); break;
        case 'bullet': buf.writeln('<li>${_htmlEsc(b.text)}</li>'); break;
        case 'todo':
          buf.writeln('<div class="todo"><input type="checkbox" ${b.checked ? "checked" : ""} disabled>${_htmlEsc(b.text)}</div>');
          break;
        case 'numbered': buf.writeln('<li>${_htmlEsc(b.text)}</li>'); break;
      }
    }
    return buf.toString();
  }

  String _mdInlineToHtml(String text) {
    // Bold + italic basico
    return text
      .replaceAllMapped(RegExp(r'\*\*(.+?)\*\*'), (m) => '<strong>${m.group(1)}</strong>')
      .replaceAllMapped(RegExp(r'\*(.+?)\*'), (m) => '<em>${m.group(1)}</em>')
      .replaceAllMapped(RegExp(r'`(.+?)`'), (m) => '<code>${m.group(1)}</code>');
  }

  String _htmlEsc(String s) {
    return s
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}

class _ParsedNote {
  final String title;
  final Map<String, String> frontmatter;
  final List<_Block> blocks;
  _ParsedNote({required this.title, required this.frontmatter, required this.blocks});
}

class _Block {
  final String type;
  final String text;
  final bool checked;
  _Block({required this.type, required this.text, this.checked = false});
}
