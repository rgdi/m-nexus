// search_result.dart: modelo para resultados de busqueda (Fase 2.A.3).

enum SearchResultType { note, card, tag }

class SearchResultItem {
  final SearchResultType type;
  final String path;
  final String title;
  final String snippet;

  const SearchResultItem({
    required this.type,
    required this.path,
    required this.title,
    required this.snippet,
  });
}
