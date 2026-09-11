// graph_isolate.dart: layout force-directed en Isolate (v0.61.3).
//
// Para grafos grandes (>200 nodos), el layout en main thread bloquea la UI.
// Aqui computamos el layout en un Isolate y devolvemos posiciones finales.

import 'dart:async';
import 'dart:isolate';
import 'dart:math' as math;
import 'dart:ui';
import '../../services/graph_view_service.dart';

class GraphIsolate {
  /// v0.61.3: ejecuta Fruchterman-Reingold en un Isolate.
  /// Devuelve Map<path, Offset> con las posiciones finales.
  static Future<Map<String, Offset>> layout(GraphData graph, {int iterations = 200, double k = 80.0}) async {
    if (graph.nodes.isEmpty) return {};
    // v0.61.3: para grafos pequenos (<=100), ejecuta inline (mas rapido que spawn isolate)
    if (graph.nodes.length <= 100) {
      return _layoutInline(graph, iterations: iterations, k: k);
    }
    final sendPort = await Isolate.spawn<List<dynamic>>(_isolateEntry, [
      graph.nodes.map((n) => [n.path, n.inDegree + n.outDegree]).toList(),
      graph.edges.map((e) => [e.from, e.to]).toList(),
      iterations, k,
    ]);
    final completer = Completer<Map<String, Offset>>();
    final receivePort = ReceivePort();
    receivePort.listen((msg) {
      if (msg is Map) {
        final result = <String, Offset>{};
        msg.forEach((k, v) {
          if (v is List && v.length == 2) {
            result[k.toString()] = Offset((v[0] as num).toDouble(), (v[1] as num).toDouble());
          }
        });
        completer.complete(result);
        receivePort.close();
        sendPort.kill();
      }
    });
    // Necesitamos enviar el receivePort al isolate
    // Re-spawn with port
    final sendPort2 = await Isolate.spawn<List<dynamic>>(
      _isolateEntryWithPort,
      [receivePort.sendPort, graph.nodes.map((n) => [n.path, n.degree]).toList(),
       graph.edges.map((e) => [e.from, e.to]).toList(), iterations, k],
    );
    return completer.future.timeout(const Duration(seconds: 30), onTimeout: () {
      sendPort2.kill();
      return _layoutInline(graph, iterations: iterations, k: k);
    });
  }

  static Map<String, Offset> _layoutInline(GraphData graph, {int iterations = 200, double k = 80.0}) {
    final width = 1000.0;
    final height = 1000.0;
    final pos = <String, Offset>{};
    final vel = <String, Offset>{};
    final rng = math.Random(42);
    for (final n in graph.nodes) {
      pos[n.path] = Offset(rng.nextDouble() * width, rng.nextDouble() * height);
      vel[n.path] = Offset.zero;
    }
    double t = width / 10;
    final cooling = t / iterations;
    for (var iter = 0; iter < iterations; iter++) {
      final disp = <String, Offset>{};
      for (final n in graph.nodes) {
        disp[n.path] = Offset.zero;
        for (final m in graph.nodes) {
          if (n.path == m.path) continue;
          final delta = pos[n.path]! - pos[m.path]!;
          final dist = math.max(0.01, delta.distance);
          final force = (k * k) / dist;
          disp[n.path] = disp[n.path]! + Offset(delta.dx / dist * force, delta.dy / dist * force);
        }
      }
      for (final e in graph.edges) {
        final delta = pos[e.from]! - pos[e.to]!;
        final dist = math.max(0.01, delta.distance);
        final force = (dist * dist) / k;
        disp[e.from] = disp[e.from]! - Offset(delta.dx / dist * force, delta.dy / dist * force);
        disp[e.to] = disp[e.to]! + Offset(delta.dx / dist * force, delta.dy / dist * force);
      }
      for (final n in graph.nodes) {
        final d = disp[n.path]!;
        final dist = math.max(0.01, d.distance);
        final limited = math.min(dist, t);
        vel[n.path] = Offset(vel[n.path]!.dx + d.dx / dist * limited, vel[n.path]!.dy + d.dy / dist * limited);
        pos[n.path] = pos[n.path]! + vel[n.path]!;
        pos[n.path] = Offset(pos[n.path]!.dx.clamp(50, width - 50), pos[n.path]!.dy.clamp(50, height - 50));
        vel[n.path] = Offset(vel[n.path]!.dx * 0.85, vel[n.path]!.dy * 0.85);
      }
      t = math.max(1, t - cooling);
    }
    return pos;
  }

  /// v0.61.3: entry point del isolate (sin port, devuelve por print — fallback).
  static void _isolateEntry(List<dynamic> args) {
    final nodes = (args[0] as List).cast<List>().map((e) => [e[0].toString(), (e[1] as num).toDouble()]).toList();
    final edges = (args[1] as List).cast<List>().map((e) => [e[0].toString(), e[1].toString()]).toList();
    final iterations = args[2] as int;
    final k = (args[3] as num).toDouble();
    final result = _layoutRaw(nodes, edges, iterations, k);
    // v0.61.3: envia a stdout
    print('GRAPH_ISOLATE_RESULT:${result.toString()}');
  }

  /// v0.61.3: entry point con port.
  static void _isolateEntryWithPort(List<dynamic> args) {
    final sendPort = args[0] as SendPort;
    final nodes = (args[1] as List).cast<List>().map((e) => [e[0].toString(), (e[1] as num).toDouble()]).toList();
    final edges = (args[2] as List).cast<List>().map((e) => [e[0].toString(), e[1].toString()]).toList();
    final iterations = args[3] as int;
    final k = (args[4] as num).toDouble();
    final result = _layoutRaw(nodes, edges, iterations, k);
    sendPort.send(result);
  }

  static Map<String, List<double>> _layoutRaw(
    List<List<dynamic>> nodes,
    List<List<String>> edges,
    int iterations,
    double k,
  ) {
    final width = 1000.0, height = 1000.0;
    final pos = <String, List<double>>{};
    final vel = <String, List<double>>{};
    final rng = math.Random(42);
    for (final n in nodes) {
      pos[n[0]] = [rng.nextDouble() * width, rng.nextDouble() * height];
      vel[n[0]] = [0.0, 0.0];
    }
    double t = width / 10;
    final cooling = t / iterations;
    for (var iter = 0; iter < iterations; iter++) {
      final disp = <String, List<double>>{};
      for (final n in nodes) {
        disp[n[0]] = [0.0, 0.0];
        for (final m in nodes) {
          if (n[0] == m[0]) continue;
          final dx = pos[n[0]]![0] - pos[m[0]]![0];
          final dy = pos[n[0]]![1] - pos[m[0]]![1];
          final dist = math.max(0.01, math.sqrt(dx * dx + dy * dy));
          final force = (k * k) / dist;
          disp[n[0]]![0] += dx / dist * force;
          disp[n[0]]![1] += dy / dist * force;
        }
      }
      for (final e in edges) {
        final dx = pos[e[0]]![0] - pos[e[1]]![0];
        final dy = pos[e[0]]![1] - pos[e[1]]![1];
        final dist = math.max(0.01, math.sqrt(dx * dx + dy * dy));
        final force = (dist * dist) / k;
        disp[e[0]]![0] -= dx / dist * force;
        disp[e[0]]![1] -= dy / dist * force;
        disp[e[1]]![0] += dx / dist * force;
        disp[e[1]]![1] += dy / dist * force;
      }
      for (final n in nodes) {
        final d = disp[n[0]]!;
        final dist = math.max(0.01, math.sqrt(d[0] * d[0] + d[1] * d[1]));
        final limited = math.min(dist, t);
        vel[n[0]]![0] += d[0] / dist * limited;
        vel[n[0]]![1] += d[1] / dist * limited;
        pos[n[0]]![0] += vel[n[0]]![0];
        pos[n[0]]![1] += vel[n[0]]![1];
        pos[n[0]]![0] = pos[n[0]]![0].clamp(50, width - 50);
        pos[n[0]]![1] = pos[n[0]]![1].clamp(50, height - 50);
        vel[n[0]]![0] *= 0.85;
        vel[n[0]]![1] *= 0.85;
      }
      t = math.max(1, t - cooling);
    }
    return pos.map((k, v) => MapEntry(k, v));
  }
}
