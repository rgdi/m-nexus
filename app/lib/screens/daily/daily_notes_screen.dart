// daily_notes_screen.dart: lista + calendario de daily notes (Notion-style).
//
// v0.49.6: vista hibrida con lista + mini calendario.
// - Lista de daily notes (más recientes primero)
// - Mini calendario con marcadores en fechas que tienen nota
// - Tap en día -> abre daily note (la crea si no existe)
// - Botón flotante "Hoy" para crear la de hoy

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../services/daily_note_service.dart';
import '../note/note_view.dart';

class DailyNotesScreen extends StatefulWidget {
  final String vaultPath;
  const DailyNotesScreen({super.key, required this.vaultPath});

  @override
  State<DailyNotesScreen> createState() => _DailyNotesScreenState();
}

class _DailyNotesScreenState extends State<DailyNotesScreen> {
  late final DailyNoteService _service;
  List<DateTime> _existingDates = [];
  DateTime _focusedMonth = DateTime.now();
  DateTime? _selectedDate;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _service = DailyNoteService(widget.vaultPath);
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final dates = await _service.listDates();
    if (!mounted) return;
    setState(() {
      _existingDates = dates;
      _loading = false;
    });
  }

  Future<void> _openDate(DateTime date) async {
    final path = await _service.openAnyDate(date);
    if (!mounted) return;
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => NoteView(
        notePath: path,
        vaultPath: widget.vaultPath,
      )),
    );
    await _load();
  }

  bool _hasNote(DateTime date) {
    final stamp = DateFormat('yyyy-MM-dd').format(date);
    return _existingDates.any((d) => DateFormat('yyyy-MM-dd').format(d) == stamp);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Daily Notes'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _load,
            tooltip: 'Recargar',
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openDate(DateTime.now()),
        icon: const Icon(Icons.today),
        label: const Text('Hoy'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                // Mini calendar
                _buildCalendar(theme, scheme),
                const Divider(height: 1),
                // Lista
                Expanded(child: _buildList(theme, scheme)),
              ],
            ),
    );
  }

  Widget _buildCalendar(ThemeData theme, ColorScheme scheme) {
    final month = _focusedMonth;
    final firstDay = DateTime(month.year, month.month, 1);
    final lastDay = DateTime(month.year, month.month + 1, 0);
    final firstWeekday = firstDay.weekday; // 1..7
    final daysInMonth = lastDay.day;

    // Build a 6x7 grid (max needed)
    final cells = <Widget>[];
    // Headers: L M X J V S D
    for (final d in ['L', 'M', 'X', 'J', 'V', 'S', 'D']) {
      cells.add(Center(
        child: Text(d, style: theme.textTheme.labelSmall?.copyWith(
          fontWeight: FontWeight.w600,
          color: scheme.onSurfaceVariant,
        )),
      ));
    }
    // Empty cells before day 1
    for (int i = 1; i < firstWeekday; i++) {
      cells.add(const SizedBox.shrink());
    }
    // Days
    for (int day = 1; day <= daysInMonth; day++) {
      final date = DateTime(month.year, month.month, day);
      final hasNote = _hasNote(date);
      final isToday = _isSameDay(date, DateTime.now());
      final isSelected = _selectedDate != null && _isSameDay(date, _selectedDate!);
      cells.add(_buildDayCell(theme, scheme, date, day, hasNote, isToday, isSelected));
    }

    return Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                DateFormat('MMMM yyyy', 'es_ES').format(month),
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
              ),
              Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.chevron_left),
                    onPressed: () => setState(() {
                      _focusedMonth = DateTime(month.year, month.month - 1, 1);
                    }),
                    tooltip: 'Mes anterior',
                  ),
                  IconButton(
                    icon: const Icon(Icons.chevron_right),
                    onPressed: () => setState(() {
                      _focusedMonth = DateTime(month.year, month.month + 1, 1);
                    }),
                    tooltip: 'Mes siguiente',
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 8),
          GridView.count(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisCount: 7,
            children: cells,
          ),
        ],
      ),
    );
  }

  Widget _buildDayCell(ThemeData theme, ColorScheme scheme, DateTime date, int day,
      bool hasNote, bool isToday, bool isSelected) {
    Color? bg;
    Color textColor = scheme.onSurface;
    if (isSelected) {
      bg = scheme.primary;
      textColor = scheme.onPrimary;
    } else if (isToday) {
      bg = scheme.primaryContainer;
      textColor = scheme.onPrimaryContainer;
    } else if (hasNote) {
      bg = scheme.surfaceContainerHigh;
    }
    return InkWell(
      onTap: () => _openDate(date),
      borderRadius: BorderRadius.circular(8),
      child: Container(
        margin: const EdgeInsets.all(2),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text('$day', style: TextStyle(
              fontWeight: isToday ? FontWeight.w700 : FontWeight.w500,
              color: textColor,
              fontSize: 13,
            )),
            if (hasNote)
              Container(
                width: 4, height: 4,
                margin: const EdgeInsets.only(top: 2),
                decoration: BoxDecoration(
                  color: isSelected ? scheme.onPrimary : scheme.primary,
                  shape: BoxShape.circle,
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildList(ThemeData theme, ColorScheme scheme) {
    if (_existingDates.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            'No tienes daily notes todavía. Pulsa "Hoy" para crear la primera.',
            style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        itemCount: _existingDates.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (context, i) {
          final date = _existingDates[i];
          return ListTile(
            leading: Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: _isSameDay(date, DateTime.now())
                    ? scheme.primaryContainer
                    : scheme.surfaceContainerHigh,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    DateFormat('d', 'es_ES').format(date),
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: _isSameDay(date, DateTime.now())
                          ? scheme.onPrimaryContainer
                          : scheme.onSurface,
                    ),
                  ),
                  Text(
                    DateFormat('MMM', 'es_ES').format(date).toUpperCase(),
                    style: TextStyle(
                      fontSize: 9,
                      color: _isSameDay(date, DateTime.now())
                          ? scheme.onPrimaryContainer
                          : scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            title: Text(DateFormat('EEEE d MMMM yyyy', 'es_ES').format(date)),
            subtitle: Text(DateFormat('HH:mm').format(DateTime(
              date.year, date.month, date.day, 9, 0,
            ))),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _openDate(date),
          );
        },
      ),
    );
  }

  bool _isSameDay(DateTime a, DateTime b) {
    return a.year == b.year && a.month == b.month && a.day == b.day;
  }
}
