// marketplace_deck.dart: modelo de deck del marketplace (Fase 5.C.2).

class MarketplaceDeck {
  final String id;
  final String name;
  final String description;
  final String author;
  final int cardCount;
  final int downloads;
  final double rating;
  final String? iconEmoji;
  final String category;
  final String language;
  final DateTime updatedAt;

  const MarketplaceDeck({
    required this.id,
    required this.name,
    required this.description,
    required this.author,
    required this.cardCount,
    required this.downloads,
    required this.rating,
    required this.category,
    required this.language,
    required this.updatedAt,
    this.iconEmoji,
  });

  factory MarketplaceDeck.fromJson(Map<String, dynamic> json) {
    return MarketplaceDeck(
      id: json['id'] as String,
      name: json['name'] as String? ?? '',
      description: json['description'] as String? ?? '',
      author: json['author'] as String? ?? 'unknown',
      cardCount: (json['cardCount'] as num?)?.toInt() ?? 0,
      downloads: (json['downloads'] as num?)?.toInt() ?? 0,
      rating: (json['rating'] as num?)?.toDouble() ?? 0.0,
      category: json['category'] as String? ?? 'general',
      language: json['language'] as String? ?? 'en',
      updatedAt: json['updatedAt'] != null
          ? DateTime.parse(json['updatedAt'] as String)
          : DateTime.now(),
      iconEmoji: json['iconEmoji'] as String?,
    );
  }
}
