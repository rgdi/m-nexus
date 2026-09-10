// formula_engine.dart: mini-parser de formulas estilo Notion.
//
// v0.60 (P1.10): evalua formulas simples con whitelist de funciones.
// Soporta: sum, avg, count, min, max, if, now, dateAdd, length, upper, lower.
//
// Sintaxis:
//   sum(precio * cantidad)
//   if(prop("Status") == "Done", 100, 0)
//   dateAdd(prop("Due"), 7, "day")
//   count(filter(prop("Status") == "Done"))
//
// NO es Turing-completo. NO permite recursión ni loops. NO evalua
// codigo arbitrario (seguridad).

import 'dart:math' as math;

class FormulaContext {
  final Map<String, dynamic> props;
  final DateTime now;
  FormulaContext({required this.props, DateTime? now}) : now = now ?? DateTime.now();
}

class FormulaEngine {
  /// v0.60 (P1.10): evalua una formula.
  dynamic evaluate(String formula, FormulaContext ctx) {
    final tokens = _tokenize(formula);
    final parser = _Parser(tokens);
    final ast = parser.parseExpression();
    return _evalAst(ast, ctx);
  }

  /// v0.60 (P1.10): convierte a string para display.
  String evaluateToString(String formula, FormulaContext ctx) {
    try {
      final r = evaluate(formula, ctx);
      if (r == null) return '';
      return r.toString();
    } catch (e) {
      return '⚠️ ${e.toString()}';
    }
  }

  List<String> _tokenize(String input) {
    final tokens = <String>[];
    final buf = StringBuffer();
    var i = 0;
    while (i < input.length) {
      final c = input[i];
      if (c == ' ' || c == '\t' || c == '\n') {
        if (buf.isNotEmpty) {
          tokens.add(buf.toString());
          buf.clear();
        }
      } else if ('+-*/()=!<>,'.contains(c)) {
        if (buf.isNotEmpty) {
          tokens.add(buf.toString());
          buf.clear();
        }
        tokens.add(c);
      } else if (c == '"') {
        // String literal
        if (buf.isNotEmpty) {
          tokens.add(buf.toString());
          buf.clear();
        }
        final end = input.indexOf('"', i + 1);
        if (end < 0) throw FormatException('String no cerrado');
        tokens.add(input.substring(i, end + 1));
        i = end;
      } else {
        buf.write(c);
      }
      i++;
    }
    if (buf.isNotEmpty) tokens.add(buf.toString());
    return tokens;
  }

  // ── AST nodes ──
  dynamic _evalAst(dynamic node, FormulaContext ctx) {
    if (node is num || node is String || node is bool) return node;
    if (node is _BinaryOp) {
      final l = _evalAst(node.left, ctx);
      final r = _evalAst(node.right, ctx);
      switch (node.op) {
        case '+': return (l as num) + (r as num);
        case '-': return (l as num) - (r as num);
        case '*': return (l as num) * (r as num);
        case '/':
          if ((r as num) == 0) throw Exception('Division by zero');
          return (l as num) / r;
        case '==': return l == r;
        case '!=': return l != r;
        case '<': return (l as num) < (r as num);
        case '>': return (l as num) > (r as num);
        case '<=': return (l as num) <= (r as num);
        case '>=': return (l as num) >= (r as num);
        case '&&': return (l as bool) && (r as bool);
        case '||': return (l as bool) || (r as bool);
        default: throw Exception('Unknown op: ${node.op}');
      }
    }
    if (node is _UnaryOp) {
      final v = _evalAst(node.expr, ctx);
      if (node.op == '-') return -(v as num);
      if (node.op == '!') return !(v as bool);
    }
    if (node is _FuncCall) {
      return _callFunction(node.name, node.args, ctx);
    }
    if (node is _Prop) {
      return ctx.props[node.name] ?? '';
    }
    if (node is _List) {
      return node.elements.map((e) => _evalAst(e, ctx)).toList();
    }
    throw Exception('Unknown AST node: $node');
  }

  dynamic _callFunction(String name, List<dynamic> rawArgs, FormulaContext ctx) {
    final args = rawArgs.map((a) => _evalAst(a, ctx)).toList();
    switch (name) {
      case 'sum':
        return args.fold<num>(0, (a, b) => a + (b as num));
      case 'avg':
      case 'average':
        if (args.isEmpty) return 0;
        return args.fold<num>(0, (a, b) => a + (b as num)) / args.length;
      case 'count':
        return args.length;
      case 'min':
        if (args.isEmpty) return 0;
        return args.cast<num>().reduce(math.min);
      case 'max':
        if (args.isEmpty) return 0;
        return args.cast<num>().reduce(math.max);
      case 'if':
        if (args.length != 3) throw Exception('if() requires 3 args');
        return (args[0] as bool) ? args[1] : args[2];
      case 'now':
        return ctx.now.millisecondsSinceEpoch;
      case 'today':
        return ctx.now.toIso8601String().substring(0, 10);
      case 'dateAdd':
        // dateAdd(date, n, "day")
        if (args.length != 3) throw Exception('dateAdd requires 3 args');
        final base = args[0] is int
          ? DateTime.fromMillisecondsSinceEpoch(args[0] as int)
          : DateTime.parse(args[0].toString());
        final n = args[1] as int;
        final unit = args[2].toString().toLowerCase();
        switch (unit) {
          case 'day':
          case 'days': return base.add(Duration(days: n)).millisecondsSinceEpoch;
          case 'hour':
          case 'hours': return base.add(Duration(hours: n)).millisecondsSinceEpoch;
          case 'minute':
          case 'minutes': return base.add(Duration(minutes: n)).millisecondsSinceEpoch;
          default: throw Exception('dateAdd unit: $unit');
        }
      case 'length':
        if (args.isEmpty) return 0;
        return args[0].toString().length;
      case 'upper': return args[0].toString().toUpperCase();
      case 'lower': return args[0].toString().toLowerCase();
      case 'prop':
        if (args.isEmpty) return '';
        return ctx.props[args[0].toString()] ?? '';
      default: throw Exception('Unknown function: $name');
    }
  }
}

class _BinaryOp {
  final String op;
  final dynamic left;
  final dynamic right;
  _BinaryOp(this.op, this.left, this.right);
}

class _UnaryOp {
  final String op;
  final dynamic expr;
  _UnaryOp(this.op, this.expr);
}

class _FuncCall {
  final String name;
  final List<dynamic> args;
  _FuncCall(this.name, this.args);
}

class _Prop {
  final String name;
  _Prop(this.name);
}

class _List {
  final List<dynamic> elements;
  _List(this.elements);
}

class _Parser {
  final List<String> tokens;
  int pos = 0;
  _Parser(this.tokens);

  String peek() => pos < tokens.length ? tokens[pos] : '';
  String consume() => tokens[pos++];

  /// expression := or_expr
  dynamic parseExpression() {
    final e = parseOr();
    if (pos < tokens.length) throw FormatException('Unexpected: ${peek()}');
    return e;
  }

  dynamic parseOr() {
    var left = parseAnd();
    while (peek() == '||') { consume(); final right = parseAnd(); left = _BinaryOp('||', left, right); }
    return left;
  }

  dynamic parseAnd() {
    var left = parseEquality();
    while (peek() == '&&') { consume(); final right = parseEquality(); left = _BinaryOp('&&', left, right); }
    return left;
  }

  dynamic parseEquality() {
    var left = parseComparison();
    while (peek() == '==' || peek() == '!=') {
      final op = consume(); final right = parseComparison();
      left = _BinaryOp(op, left, right);
    }
    return left;
  }

  dynamic parseComparison() {
    var left = parseAdditive();
    while (peek() == '<' || peek() == '>' || peek() == '<=' || peek() == '>=') {
      String op = consume();
      if (peek() == '=') op += consume();
      final right = parseAdditive();
      left = _BinaryOp(op, left, right);
    }
    return left;
  }

  dynamic parseAdditive() {
    var left = parseMultiplicative();
    while (peek() == '+' || peek() == '-') {
      final op = consume(); final right = parseMultiplicative();
      left = _BinaryOp(op, left, right);
    }
    return left;
  }

  dynamic parseMultiplicative() {
    var left = parseUnary();
    while (peek() == '*' || peek() == '/') {
      final op = consume(); final right = parseUnary();
      left = _BinaryOp(op, left, right);
    }
    return left;
  }

  dynamic parseUnary() {
    if (peek() == '-') { consume(); return _UnaryOp('-', parseUnary()); }
    if (peek() == '!') { consume(); return _UnaryOp('!', parseUnary()); }
    return parsePrimary();
  }

  dynamic parsePrimary() {
    final t = peek();
    if (t == '(') {
      consume();
      final e = parseOr();
      if (consume() != ')') throw FormatException('Expected )');
      return e;
    }
    if (t.startsWith('"') && t.endsWith('"')) {
      consume();
      return t.substring(1, t.length - 1);
    }
    if (RegExp(r'^-?\d+(\.\d+)?$').hasMatch(t)) {
      consume();
      return num.parse(t);
    }
    if (t == 'true' || t == 'false') { consume(); return t == 'true'; }
    // Function call
    if (pos + 1 < tokens.length && tokens[pos + 1] == '(') {
      final name = consume();
      consume();
      final args = <dynamic>[];
      if (peek() != ')') {
        args.add(parseOr());
        while (peek() == ',') { consume(); args.add(parseOr()); }
      }
      if (consume() != ')') throw FormatException('Expected ) after args');
      return _FuncCall(name, args);
    }
    // Lista
    if (t == '[') {
      consume();
      final elements = <dynamic>[];
      if (peek() != ']') {
        elements.add(parseOr());
        while (peek() == ',') { consume(); elements.add(parseOr()); }
      }
      if (consume() != ']') throw FormatException('Expected ]');
      return _List(elements);
    }
    // Propiedad
    consume();
    return _Prop(t);
  }
}
