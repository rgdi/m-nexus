// marketplace_client.dart: cliente HTTP para marketplace (Fase 5.C.2).
//
// v0.46: integra con MarketplaceService.ts del backend.
//   GET  /api/v1/marketplace/decks?category=&sort=&search=
//   POST /api/v1/marketplace/decks/:id/install

import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/marketplace_deck.dart';

class MarketplaceException implements Exception {
  final String message;
  final int? statusCode;
  MarketplaceException(this.message, {this.statusCode});
  @override
  String toString() => 'MarketplaceException($statusCode): $message';
}

class MarketplaceClient {
  final String backendUrl;
  final String? authToken;
  final http.Client _http;

  MarketplaceClient({
    required this.backendUrl,
    this.authToken,
    http.Client? client,
  }) : _http = client ?? http.Client();

  Future<List<MarketplaceDeck>> list({
    String? category,
    String sort = 'popular',
    String? search,
  }) async {
    final queryParams = <String, String>{
      'sort': sort,
      if (category != null) 'category': category,
      if (search != null) 'search': search,
    };
    final uri = Uri.parse('$backendUrl/api/v1/marketplace/decks')
        .replace(queryParameters: queryParams);
    final headers = {
      if (authToken != null) 'Authorization': 'Bearer $authToken',
    };

    final response = await _http.get(uri, headers: headers);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      final list = (json['decks'] as List?) ?? [];
      return list.map((e) => MarketplaceDeck.fromJson(e as Map<String, dynamic>)).toList();
    }
    throw MarketplaceException(response.body, statusCode: response.statusCode);
  }

  Future<void> install(String deckId) async {
    final uri = Uri.parse('$backendUrl/api/v1/marketplace/decks/$deckId/install');
    final headers = {
      'Content-Type': 'application/json',
      if (authToken != null) 'Authorization': 'Bearer $authToken',
    };

    final response = await _http.post(uri, headers: headers, body: jsonEncode({}));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw MarketplaceException(response.body, statusCode: response.statusCode);
    }
  }

  void close() => _http.close();
}
