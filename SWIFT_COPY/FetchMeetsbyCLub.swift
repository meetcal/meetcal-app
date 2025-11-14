//
//  FetchMeetsByClub.swift
//  meetcal
//
//  Created by Maddisen Mohnsen on 10/22/25.
//

import Supabase
import Foundation
import Combine

struct AthleteClub: Decodable, Hashable {
    let member_id: String
    let name: String
    let club: String
    let meet: String
}

struct ClubMeetStats {
    var totalAthletes: Int = 0
    var goldMedals: Int = 0
    var silverMedals: Int = 0
    var bronzeMedals: Int = 0
    var totalPRs: Int = 0
    var perfect6for6: Int = 0
    var totalWeightLifted: Float = 0.0
    var athleteResults: [AthleteResults] = []
}

@MainActor
class FetchMeetsByClub: ObservableObject {
    @Published var isLoading: Bool = false
    @Published var error: Error?
    @Published var athletesInClub: [AthleteClub] = []
    @Published var athletesInClubResults: [AthleteResults] = []
    @Published var allClubs: [String] = []
    @Published var clubStats: ClubMeetStats = ClubMeetStats()

    func loadAllClubs() async {
        isLoading = true
        error = nil

        do {
            let response = try await supabase
                .from("athletes")
                .select("club")
                .execute()

            struct ClubRow: Decodable {
                let club: String
            }

            let rows = try JSONDecoder().decode([ClubRow].self, from: response.data)
            let uniqueClubs = Array(Set(rows.map { $0.club })).sorted()
            self.allClubs = uniqueClubs
        } catch {
            self.error = error
        }
        isLoading = false
    }

    func loadAthletesByClub(club: String) async {
        isLoading = true
        error = nil

        do {
            // First get all athletes from this club
            let response = try await supabase
                .from("athletes")
                .select("member_id, name, club, meet")
                .eq("club", value: club)
                .execute()

            let allAthletes = try JSONDecoder().decode([AthleteClub].self, from: response.data)

            // Get the unique meets from these athletes
            let uniqueMeets = Array(Set(allAthletes.map { $0.meet }))

            // Fetch the status of these meets
            let meetsResponse = try await supabase
                .from("meets")
                .select("name, status")
                .in("name", values: uniqueMeets)
                .execute()

            struct MeetStatus: Decodable {
                let name: String
                let status: String
            }

            let meetsWithStatus = try JSONDecoder().decode([MeetStatus].self, from: meetsResponse.data)

            // Filter to only keep completed meets
            let completedMeetNames = Set(meetsWithStatus.filter { $0.status == "completed" }.map { $0.name })

            // Filter athletes to only those in completed meets
            let filteredAthletes = allAthletes.filter { completedMeetNames.contains($0.meet) }

            self.athletesInClub = filteredAthletes
        } catch {
            self.error = error
        }
        isLoading = false
    }
    
    func loadMeetsByClub(name: String) async {
        isLoading = true
        error = nil

        do {
            let response = try await supabase
                .from("lifting_results")
                .select()
                .neq("federation", value: "BWL")
                .eq("name", value: name)
                .execute()

            let rows = try JSONDecoder().decode([AthleteResults].self, from: response.data)
            self.athletesInClubResults = rows
        } catch {
            self.error = error
        }
        isLoading = false
    }

    func loadClubMeetStats(club: String, meet: String) async {
        isLoading = true
        error = nil

        do {
            // Step 1: Get all athletes from this club at this meet
            let athletesResponse = try await supabase
                .from("athletes")
                .select("name, age, gender, weight_class")
                .eq("club", value: club)
                .eq("meet", value: meet)
                .execute()

            struct AthleteInfo: Decodable {
                let name: String
                let age: Int
                let gender: String
                let weight_class: String
            }

            let clubAthletes = try JSONDecoder().decode([AthleteInfo].self, from: athletesResponse.data)
            let athleteNames = clubAthletes.map { $0.name }

            guard !athleteNames.isEmpty else {
                self.clubStats = ClubMeetStats()
                isLoading = false
                return
            }

            // Step 2: Get lifting results for these athletes at this meet
            let resultsResponse = try await supabase
                .from("lifting_results")
                .select()
                .in("name", values: athleteNames)
                .eq("meet", value: meet)
                .execute()

            let results = try JSONDecoder().decode([AthleteResults].self, from: resultsResponse.data)

            // Step 3: Get ALL athletes info from this meet for medal calculations
            let allMeetAthletesResponse = try await supabase
                .from("athletes")
                .select("name, weight_class")
                .eq("meet", value: meet)
                .execute()

            struct AthleteWeightClass: Decodable {
                let name: String
                let weight_class: String
            }

            let allMeetAthletes = try JSONDecoder().decode([AthleteWeightClass].self, from: allMeetAthletesResponse.data)

            // Step 4: Get all lifting results from this meet
            let allMeetResultsResponse = try await supabase
                .from("lifting_results")
                .select()
                .eq("meet", value: meet)
                .execute()

            let allMeetResults = try JSONDecoder().decode([AthleteResults].self, from: allMeetResultsResponse.data)

            // Step 5: Get historical results for PR calculations
            let historicalResponse = try await supabase
                .from("lifting_results")
                .select()
                .neq("federation", value: "BWL")
                .in("name", values: athleteNames)
                .lt("date", value: results.first?.date ?? "")
                .execute()

            let historicalResults = try JSONDecoder().decode([AthleteResults].self, from: historicalResponse.data)

            // Calculate stats
            var stats = ClubMeetStats()
            stats.totalAthletes = results.count
            stats.athleteResults = results

            // Calculate total weight lifted
            stats.totalWeightLifted = results.reduce(0) { $0 + $1.total }

            // Calculate 6/6 days
            for result in results {
                let lifts = [result.snatch1, result.snatch2, result.snatch3, result.cj1, result.cj2, result.cj3]
                let allGood = lifts.allSatisfy { $0 > 0 }
                if allGood {
                    stats.perfect6for6 += 1
                }
            }

            // Calculate PRs by comparing to historical bests
            for result in results {
                let athleteHistory = historicalResults.filter { $0.name == result.name }
                let bestHistorical = athleteHistory.map { $0.total }.max() ?? 0

                if result.total > bestHistorical {
                    stats.totalPRs += 1
                }
            }

            // Calculate medals - check snatch, c&j, and total separately by weight class
            for clubAthlete in clubAthletes {
                guard let athleteResult = results.first(where: { $0.name == clubAthlete.name }) else { continue }

                // Get all results in this athlete's weight class
                let athletesInWeightClass = allMeetAthletes.filter { $0.weight_class == clubAthlete.weight_class }
                let namesInWeightClass = athletesInWeightClass.map { $0.name }
                let resultsInWeightClass = allMeetResults.filter { namesInWeightClass.contains($0.name) && $0.total > 0 }

                // Medal for SNATCH
                let sortedBySnatch = resultsInWeightClass.sorted { $0.snatch_best > $1.snatch_best }
                if let snatchRank = sortedBySnatch.firstIndex(where: { $0.name == clubAthlete.name }) {
                    switch snatchRank {
                    case 0: stats.goldMedals += 1
                    case 1: stats.silverMedals += 1
                    case 2: stats.bronzeMedals += 1
                    default: break
                    }
                }

                // Medal for CLEAN & JERK
                let sortedByCJ = resultsInWeightClass.sorted { $0.cj_best > $1.cj_best }
                if let cjRank = sortedByCJ.firstIndex(where: { $0.name == clubAthlete.name }) {
                    switch cjRank {
                    case 0: stats.goldMedals += 1
                    case 1: stats.silverMedals += 1
                    case 2: stats.bronzeMedals += 1
                    default: break
                    }
                }

                // Medal for TOTAL
                let sortedByTotal = resultsInWeightClass.sorted { $0.total > $1.total }
                if let totalRank = sortedByTotal.firstIndex(where: { $0.name == clubAthlete.name }) {
                    switch totalRank {
                    case 0: stats.goldMedals += 1
                    case 1: stats.silverMedals += 1
                    case 2: stats.bronzeMedals += 1
                    default: break
                    }
                }
            }

            self.clubStats = stats
        } catch {
            self.error = error
        }
        isLoading = false
    }
}
