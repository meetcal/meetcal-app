//
//  SnippetViews.swift
//  MeetCal App Intents
//
//  Small SwiftUI snippet views shown by intents via `ShowsSnippetView`.
//  Styling intentionally mirrors the widget's list rows.
//

import SwiftUI

struct SnippetPlatformChip: View {
    let text: String

    private func color() -> Color {
        switch text {
        case "Red": return .red
        case "White": return .gray
        case "Stars": return .indigo
        case "Stripes": return .green
        case "Rogue": return .black
        default: return .blue
        }
    }

    var body: some View {
        Text(text)
            .frame(minWidth: 45, minHeight: 20)
            .font(.caption)
            .padding(.horizontal, 10)
            .background(color())
            .foregroundStyle(.white)
            .cornerRadius(10)
    }
}

/// A generic snippet list: a header + up to N rows of leading chip / title /
/// subtitle / trailing text.
struct SnippetRow: Identifiable {
    let id = UUID()
    let leading: String
    let title: String
    let subtitle: String?
    let trailing: String?

    init(leading: String, title: String, subtitle: String? = nil, trailing: String? = nil) {
        self.leading = leading
        self.title = title
        self.subtitle = subtitle
        self.trailing = trailing
    }
}

struct SnippetListView: View {
    let title: String
    let subtitle: String?
    let rows: [SnippetRow]
    let emptyMessage: String
    var systemImage: String = "calendar"

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                    .foregroundStyle(.blue)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.headline)
                        .foregroundStyle(.blue)
                        .lineLimit(1)
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundStyle(.primary.opacity(0.7))
                            .lineLimit(1)
                    }
                }
                Spacer()
            }

            Divider()

            if rows.isEmpty {
                Text(emptyMessage)
                    .font(.subheadline)
                    .foregroundStyle(.primary.opacity(0.7))
            } else {
                ForEach(rows.prefix(8)) { row in
                    HStack(alignment: .center, spacing: 8) {
                        if !row.leading.isEmpty {
                            SnippetPlatformChip(text: row.leading)
                        }
                        VStack(alignment: .leading, spacing: 1) {
                            Text(row.title)
                                .font(.subheadline)
                                .bold()
                                .foregroundStyle(.primary)
                                .lineLimit(1)
                            if let subtitle = row.subtitle, !subtitle.isEmpty {
                                Text(subtitle)
                                    .font(.caption)
                                    .foregroundStyle(.primary.opacity(0.7))
                                    .lineLimit(1)
                            }
                        }
                        Spacer(minLength: 4)
                        if let trailing = row.trailing, !trailing.isEmpty {
                            Text(trailing)
                                .font(.subheadline)
                                .bold()
                                .foregroundStyle(.primary)
                                .lineLimit(1)
                        }
                    }
                }
            }
        }
        .padding()
    }
}
