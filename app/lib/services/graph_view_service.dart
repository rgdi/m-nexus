// graph_view_service.dart: knowledge graph del vault.
//
// v0.60 (P1.5): genera un grafo de notas conectadas por wikilinks.
// Usado por el GraphViewScreen para visualizacion estilo Obsidian.
//
// Algoritmo:
//   1. Walk all .md files in vault
//   2. Extract [[wikilinks]] from each
//   3. Resolve wikilink targets to note paths
//   4. Build nodes (notes) and edges (links)
//   5. Compute degree (in+out) for sizing

import 'dart:io';
import 'package:path/path.dart' as p;

class GraphNode {
  final String path;
  final String title;
  final String? folder;
  final int inDegree;
  final int outDegree;
  GraphNode({
    required this.path,
    required this.title,
    this.folder,
    required this.inDegree,
    required this.outDegree,
  });
  int get degree => inDegree + outDegree;
}

class GraphEdge {
  final String from;
  final String to;
  const GraphEdge({required this.from, required this.to});
}

class GraphData {
  final List<GraphNode> nodes;
  final List<GraphEdge> edges;
  const GraphData({required this.nodes, required this.edges});
}

class GraphViewService {
  final String vaultPath;
  static const _wikilinkRe = RegExp(r'\[\[([^\[\]|]+)(?:\|[^\]]*)?\]\]');

  GraphViewService(this.vaultPath);

  /// v0.60 (P1.5): extrae wikilinks de un texto.
  /// Devuelve la lista de nombres linkeados.
  static List<String> extractWikilinks(String text) {
    return _wikilinkRe.allMatches(text).map((m) => m.group(1)!.trim()).toList();
  }

  /// v0.60 (P1.5): resuelve un wikilink a un path absoluto del vault.
  /// Busca por title (frontmatter title) o nombre de archivo.
  Future<String?> resolveWikilink(String target, Map<String, String> titleToPath) async {
    // 1) Match por title conocido
    if (titleToPath.containsKey(target)) return titleToPath[target];
    // 2) Match por nombre de archivo (con o sin .md)
    final candidates = [
      p.join(vaultPath, '$target.md'),
      p.join(vaultPath, '$target'),
    ];
    for (final c in candidates) {
      if (await File(c).exists()) return c;
    }
    return null;
  }

  /// v0.60 (P1.5): construye el grafo completo del vault.
  Future<GraphData> build({int maxNodes = 500}) async {
    final root = Directory(vaultPath);
    if (!await root.exists()) return const GraphData(nodes: [], edges: []);

    // 1) Scan: collect all notes + their titles (frontmatter)
    final allPaths = <String>[];
    final titleToPath = <String, String>{};
    await for (final entity in root.list(recursive: true, followLinks: false)) {
      if (entity is! File || !entity.path.endsWith('.md')) continue;
      final rel = p.relative(entity.path, from: vaultPath);
      if (rel.split('/').any((p) => p.startsWith('.') || p == 'Exports' || p == 'Whiteboards')) continue;
      allPaths.add(entity.path);
      try {
        final raw = await entity.readAsString();
        if (raw.startsWith('---')) {
          final end = raw.indexOf('---', 3);
          if (end > 0) {
            for (final line in raw.substring(3, end).split('\n')) {
              final i = line.indexOf(':');
              if (i <= 0) continue;
              if (line.substring(0, i).trim() == 'title') {
                titleToPath[line.substring(i + 1).trim()] = entity.path;
                break;
              }
            }
          }
        }
      } catch (_) {}
    }
    if (allPaths.length > maxNodes) {
      // Limita a los mas recientes
      allPaths.sort((a, b) {
        final sa = File(a).statSync().modified;
        final sb = File(b).statSync().modified;
        return sb.compareTo(sa);
      });
      allPaths.removeRange(maxNodes, allPaths.length);
    }

    // 2) Build edges: for each note, extract wikilinks, resolve
    final edges = <GraphEdge>[];
    final inDeg = <String, int>{};
    final outDeg = <String, int>{};
    final titleCache = <String, String>{};
    // Inicializar
    for (final p in allPaths) {
      inDeg[p] = 0;
      outDeg[p] = 0;
    }
    for (final notePath in allPaths) {
      try {
        final raw = await File(notePath).readAsString();
        // Quitar frontmatter
        var content = raw;
        if (content.startsWith('---')) {
          final end = content.indexOf('---', 3);
          if (end > 0) content = content.substring(end + 3);
        }
        final links = extractWikilinks(content);
        for (final target in links) {
          final resolved = await resolveWikilink(target, titleToPath);
          if (resolved == null || !allPaths.contains(resolved)) continue;
          edges.add(GraphEdge(from: notePath, to: resolved));
          outDeg[notePath] = (outDeg[notePath] ?? 0) + 1;
          inDeg[resolved] = (inDeg[resolved] ?? 0) + 1;
        }
      } catch (_) {}
    }

    // 3) Build nodes
    final nodes = <GraphNode>[];
    for (final path in allPaths) {
      String title = p.basenameWithoutExtension(path);
      try {
        final raw = await File(path).readAsString();
        if (raw.startsWith('---')) {
          final end = raw.indexOf('---', 3);
          if (end > 0) {
            for (final line in raw.substring(3, end).split('\n')) {
              final i = line.indexOf(':');
              if (i > 0 && line.substring(0, i).trim() == 'title') {
                title = line.substring(i + 1).trim();
                break;
              }
            }
          }
        }
      } catch (_) {}
      final folder = p.dirname(p.relative(path, from: vaultPath));
      nodes.add(GraphNode(
        path: path,
        title: title,
        folder: folder != '.' ? folder : null,
        inDegree: inDeg[path] ?? 0,
        outDegree: outDeg[path] ?? 0,
      ));
    }
    return GraphData(nodes: nodes, edges: edges);
  }
}
