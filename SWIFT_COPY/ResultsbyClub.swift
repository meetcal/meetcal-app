//
//  ShareMeetResultsByClub.swift
//  meetcal
//
//  Created by Maddisen Mohnsen on 10/22/25.
//

import SwiftUI
import RevenueCat
import RevenueCatUI

struct ShareMeetResultsByClub: View {
    @State private var searchText: String = ""
    @StateObject private var viewModel = FetchMeetsByClub()

    var filteredClubs: [String] {
        if searchText.isEmpty {
            return viewModel.allClubs
        } else {
            return viewModel.allClubs.filter { $0.localizedCaseInsensitiveContains(searchText) }
        }
    }

    var body: some View {
        NavigationStack {
            VStack {
                if viewModel.isLoading {
                    ProgressView()
                } else {
                    List(filteredClubs, id: \.self) { club in
                        NavigationLink(destination: ClubMeetsList(club: club)) {
                            Text(club)
                        }
                    }
                }
            }
            .navigationTitle("Share Meet Results")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, placement: .automatic, prompt: "Search for your club...")
            .task {
                await viewModel.loadAllClubs()
            }
        }
    }
}

struct ClubMeetsList: View {
    let club: String
    @StateObject private var viewModel = FetchMeetsByClub()

    var uniqueMeets: [String] {
        Array(Set(viewModel.athletesInClub.map { $0.meet })).sorted()
    }

    var body: some View {
        VStack {
            if viewModel.isLoading {
                ProgressView()
            } else if uniqueMeets.isEmpty {
                VStack {
                    Text("No meets found for \(club)")
                        .foregroundColor(.secondary)
                    Text("Athletes: \(viewModel.athletesInClub.count)")
                        .font(.caption)
                }
                .padding()
            } else {
                List(uniqueMeets, id: \.self) { meet in
                    NavigationLink(destination: MeetResultsByClubView(club: club, meet: meet)) {
                        Text(meet)
                    }
                }
            }
        }
        .navigationTitle(club)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await viewModel.loadAthletesByClub(club: club)
        }
    }
}

struct MeetResultsByClubView: View {
    let club: String
    let meet: String
    @StateObject private var viewModel = FetchMeetsByClub()
    @State private var generatedImage: UIImage?
    @State private var isShowingPreview: Bool = false
    @State private var isShowingShareSheet: Bool = false
    @Environment(\.colorScheme) var colorScheme

    // Computed properties to access viewModel data (like StartListView pattern)
    var clubStats: ClubMeetStats { viewModel.clubStats }

    @MainActor
    private func generateImage() {
        // Ensure data is loaded before capturing
        guard clubStats.totalAthletes > 0 else {
            return
        }

        let view = ShareableMeetRecapView(
            club: club,
            meet: meet,
            stats: clubStats
        )

        let renderer = ImageRenderer(content: view)
        renderer.scale = UIScreen.main.scale
        // Set opaque background to avoid alpha channel issues
        renderer.isOpaque = true

        guard let image = renderer.uiImage else {
            return
        }

        generatedImage = image
    }

    private func showPreview() {
        isShowingShareSheet = false
        isShowingPreview = true
    }

    var body: some View {
        ScrollView {
            if viewModel.isLoading {
                ProgressView()
                    .padding()
            } else {
                VStack(spacing: 20) {
                    VStack(spacing: 8) {
                        Text(club)
                            .font(.title)
                            .fontWeight(.bold)
                            .multilineTextAlignment(.center)

                        Text(meet)
                            .font(.headline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top)

                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 16) {
                        StatCard(
                            title: "Athletes",
                            value: "\(viewModel.clubStats.totalAthletes)",
                            icon: "person.3.fill",
                            color: .blue
                        )

                        StatCard(
                            title: "Total Weight",
                            value: String(format: "%.0f kg", viewModel.clubStats.totalWeightLifted),
                            icon: "scalemass.fill",
                            color: .purple
                        )

                        StatCard(
                            title: "Competition PRs",
                            value: "\(viewModel.clubStats.totalPRs)",
                            icon: "star.fill",
                            color: .orange
                        )

                        StatCard(
                            title: "Perfect 6/6",
                            value: "\(viewModel.clubStats.perfect6for6)",
                            icon: "checkmark.circle.fill",
                            color: .green
                        )
                    }
                    .padding(.horizontal)

                    VStack(spacing: 12) {
                        Text("Medals")
                            .font(.title2)
                            .fontWeight(.semibold)

                        HStack(spacing: 30) {
                            MedalView(
                                count: viewModel.clubStats.goldMedals,
                                type: "Gold",
                                color: Color(red: 1.0, green: 0.84, blue: 0.0)
                            )

                            MedalView(
                                count: viewModel.clubStats.silverMedals,
                                type: "Silver",
                                color: Color(red: 0.75, green: 0.75, blue: 0.75)
                            )

                            MedalView(
                                count: viewModel.clubStats.bronzeMedals,
                                type: "Bronze",
                                color: Color(red: 0.8, green: 0.5, blue: 0.2)
                            )
                        }
                    }
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(12)
                    .padding(.horizontal)

                    Spacer()
                }
            }
        }
        .navigationTitle("Meet Recap")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showPreview()
                } label: {
                    Image(systemName: "square.and.arrow.up")
                }
                .disabled(viewModel.isLoading || generatedImage == nil)
            }
        }
        .sheet(isPresented: $isShowingPreview) {
            ImagePreviewSheet(
                image: generatedImage,
                isPresented: $isShowingPreview,
                showShareSheet: $isShowingShareSheet,
                colorScheme: colorScheme
            )
        }
        .sheet(isPresented: $isShowingShareSheet) {
            if let image = generatedImage {
                ClubShareSheet(items: [image])
            }
        }
        .task {
            await viewModel.loadClubMeetStats(club: club, meet: meet)
            generateImage()
        }
    }
}

struct StatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 30))
                .foregroundColor(color)

            Text(value)
                .font(.system(size: 28, weight: .bold))

            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

struct MedalView: View {
    let count: Int
    let type: String
    let color: Color

    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                Circle()
                    .fill(color)
                    .frame(width: 50, height: 50)

                Text("\(count)")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(.white)
            }

            Text(type)
                .font(.caption)
                .foregroundColor(.secondary)
        }
    }
}

struct ShareableMeetRecapView: View {
    let club: String
    let meet: String
    let stats: ClubMeetStats

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 12) {
                Text(club)
                    .font(.system(size: 36, weight: .bold))
                    .multilineTextAlignment(.center)

                Text(meet)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(.blue)
                    .multilineTextAlignment(.center)
            }
            .padding(.vertical, 40)
            .frame(maxWidth: .infinity)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 20) {
                ShareableStatCard(
                    title: "Athletes",
                    value: "\(stats.totalAthletes)",
                    icon: "person.3.fill",
                    color: .blue
                )

                ShareableStatCard(
                    title: "Total Weight",
                    value: String(format: "%.0f kg", stats.totalWeightLifted),
                    icon: "scalemass.fill",
                    color: .purple
                )

                ShareableStatCard(
                    title: "Competition PRs",
                    value: "\(stats.totalPRs)",
                    icon: "star.fill",
                    color: .orange
                )

                ShareableStatCard(
                    title: "Perfect 6/6",
                    value: "\(stats.perfect6for6)",
                    icon: "checkmark.circle.fill",
                    color: .green
                )
            }
            .padding(.horizontal, 30)

            VStack(spacing: 20) {
                Text("Medals")
                    .font(.system(size: 28, weight: .semibold))
                    .padding(.top, 40)

                HStack(spacing: 50) {
                    ShareableMedalView(
                        count: stats.goldMedals,
                        type: "Gold",
                        color: Color(red: 1.0, green: 0.84, blue: 0.0)
                    )

                    ShareableMedalView(
                        count: stats.silverMedals,
                        type: "Silver",
                        color: Color(red: 0.75, green: 0.75, blue: 0.75)
                    )

                    ShareableMedalView(
                        count: stats.bronzeMedals,
                        type: "Bronze",
                        color: Color(red: 0.8, green: 0.5, blue: 0.2)
                    )
                }
                .padding(.bottom, 40)
            }
            .frame(maxWidth: .infinity)
            .background(Color(.systemGray6))
            .cornerRadius(20)
            .padding(.horizontal, 30)
            .padding(.top, 30)

            Spacer()

            HStack {
                Spacer()
                Text("Generated by MeetCal")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                Image("meetcal-logo")
                    .resizable()
                    .frame(width: 30, height: 30)
                Spacer()
            }
            .padding(.vertical, 30)
        }
        .frame(width: 800, height: 1000)
        .background(Color.white)
    }
}

struct ShareableStatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 40))
                .foregroundColor(color)

            Text(value)
                .font(.system(size: 36, weight: .bold))

            Text(title)
                .font(.system(size: 14))
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 30)
        .background(Color(.systemGray6))
        .cornerRadius(16)
    }
}

struct ShareableMedalView: View {
    let count: Int
    let type: String
    let color: Color

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(color)
                    .frame(width: 80, height: 80)

                Text("\(count)")
                    .font(.system(size: 36, weight: .bold))
                    .foregroundColor(.white)
            }

            Text(type)
                .font(.system(size: 16))
                .foregroundColor(.secondary)
        }
    }
}

private struct ImagePreviewSheet: View {
    let image: UIImage?
    @Binding var isPresented: Bool
    @Binding var showShareSheet: Bool
    let colorScheme: ColorScheme

    var body: some View {
        NavigationStack {
            ZStack {
                Color(.systemGroupedBackground)
                    .ignoresSafeArea()

                if let image = image {
                    ScrollView {
                        VStack(spacing: 20) {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFit()
                                .cornerRadius(12)
                                .shadow(radius: 5)
                                .padding()

                            Button {
                                isPresented = false
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                                    showShareSheet = true
                                }
                            } label: {
                                HStack {
                                    Image(systemName: "square.and.arrow.up")
                                    Text("Share Recap")
                                }
                                .frame(maxWidth: .infinity)
                                .padding()
                                .foregroundStyle(.white)
                                .background(.blue)
                                .cornerRadius(12)
                            }
                            .padding(.horizontal)
                        }
                        .padding(.top)
                    }
                } else {
                    Text("No image available")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Recap Preview")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        isPresented = false
                    }
                }
            }
        }
    }
}

struct ShareableImageClub: Identifiable {
    let id = UUID()
    let image: UIImage
}

struct ClubShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
        controller.excludedActivityTypes = []
        return controller
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

#Preview {
    ShareMeetResultsByClub()
}
