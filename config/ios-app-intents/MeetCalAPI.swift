//
//  MeetCalAPI.swift
//  MeetCal App Intents
//
//  Minimal async URLSession client for the public MeetCal REST API.
//  Request/response shapes mirror lib/api/meetcal-api.ts. Only the fields the
//  intents actually use are decoded; unknown fields are ignored so server
//  additions never break the client.
//

import Foundation

// MARK: - Response models (decode-what-you-need)

struct APIMeet: Decodable {
    let id: String?
    let name: String
    let start_date: String
    let end_date: String
    let time_zone: String?
    let venue_name: String?
    let venue_city: String?
    let venue_state: String?
    let status: String?

    var locationLine: String {
        [venue_name, [venue_city, venue_state].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " — ")
    }

    var datesLine: String {
        if start_date == end_date { return APIDateFormat.pretty(start_date) }
        return "\(APIDateFormat.pretty(start_date)) – \(APIDateFormat.pretty(end_date))"
    }
}

struct APIScheduleRow: Decodable {
    let date: String
    let meet: String?
    let platform: String
    let session_id: Int
    let start_time: String
    let weigh_in_time: String?
    let weight_class: String
}

struct APIAthlete: Decodable {
    let member_id: String?
    let name: String
    let age: Int?
    let club: String?
    let gender: String?
    let weight_class: String?
    let entry_total: Int?
    let meet: String?
    let session_number: Int?
    let session_platform: String?
    let wso: String?
}

struct APILiftingResult: Decodable {
    let meet: String?
    let date: String?
    let name: String?
    let age: String?
    let body_weight: Double?
    let snatch_best: Int?
    let cj_best: Int?
    let total: Int?
}

struct APISearchResponse: Decodable {
    let matched_name: String?
    let suggestions: [String]?
    let results: [APILiftingResult]?
}

struct APIYearBests: Decodable {
    let best_snatch: Double?
    let best_cj: Double?
    let best_total: Double?
}

struct APIQualifyingTotalRow: Decodable {
    let event_name: String?
    let gender: String?
    let age_category: String?
    let weight_class: String?
    let qualifying_total: Double?
}

struct APIStandardRow: Decodable {
    let age_category: String?
    let gender: String?
    let standard_a: Double?
    let standard_b: Double?
    let weight_class: String?
}

struct APIRecordRow: Decodable {
    let age_category: String?
    let gender: String?
    let weight_class: String?
    let record_type: String?
    let snatch_record: Double?
    let cj_record: Double?
    let total_record: Double?
}

struct APIIntlRankingRow: Decodable {
    let meet: String?
    let ranking: Int?
    let name: String?
    let weight_class: String?
    let total: Double?
    let percent_a: Double?
    let gender: String?
    let age_category: String?
}

enum APIDateFormat {
    static func pretty(_ iso: String) -> String {
        let input = DateFormatter()
        input.dateFormat = "yyyy-MM-dd"
        input.locale = Locale(identifier: "en_US_POSIX")
        let datePart = String(iso.prefix(10))
        guard let date = input.date(from: datePart) else { return iso }
        let output = DateFormatter()
        output.dateStyle = .medium
        output.timeStyle = .none
        return output.string(from: date)
    }
}

// MARK: - Client

enum MeetCalAPIError: Error {
    case badStatus(Int)
    case invalidURL
}

actor MeetCalAPI {
    static let shared = MeetCalAPI()

    private let baseURL = URL(string: "https://api.meetcal.app")!
    private let session: URLSession
    private let ttl: TimeInterval = 300 // ~5 minutes

    // In-memory cache: url string -> (timestamp, raw data)
    private var memoryCache: [String: (Date, Data)] = [:]

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 12
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        self.session = URLSession(configuration: config)
    }

    // MARK: Public endpoints

    func meets() async throws -> [APIMeet] {
        try await getDecoded("/meets")
    }

    func schedule(meet: String) async throws -> [APIScheduleRow] {
        try await getDecoded("/meets/schedule", query: ["meet": meet])
    }

    func athletes(meet: String) async throws -> [APIAthlete] {
        try await getDecoded("/meets/athletes", query: ["meet": meet])
    }

    func search(_ query: String) async throws -> APISearchResponse {
        // The live API accepts the search term as `query` (see meetcal-api.ts).
        try await getDecoded("/search", query: ["query": query])
    }

    func resultsByNames(_ names: [String]) async throws -> [APILiftingResult] {
        guard !names.isEmpty else { return [] }
        return try await getDecoded(
            "/lifting-results/by-names",
            query: ["names": names.joined(separator: ",")]
        )
    }

    func bests(names: [String]) async throws -> [String: APIYearBests] {
        guard !names.isEmpty else { return [:] }
        return try await getDecoded(
            "/lifting-results/bests",
            query: ["names": names.joined(separator: ",")]
        )
    }

    func qualifyingTotals() async throws -> [APIQualifyingTotalRow] {
        try await getDecoded("/data/qualifying-totals")
    }

    func standards() async throws -> [APIStandardRow] {
        try await getDecoded("/data/standards")
    }

    func records() async throws -> [APIRecordRow] {
        try await getDecoded("/data/records")
    }

    func intlRankings() async throws -> [APIIntlRankingRow] {
        try await getDecoded("/data/intl-rankings")
    }

    // MARK: Core request

    private func getDecoded<T: Decodable>(
        _ path: String,
        query: [String: String] = [:]
    ) async throws -> T {
        let data = try await getData(path, query: query)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func getData(_ path: String, query: [String: String]) async throws -> Data {
        var components = URLComponents(
            url: baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )
        if !query.isEmpty {
            components?.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components?.url else { throw MeetCalAPIError.invalidURL }
        let cacheKey = url.absoluteString

        if let cached = cachedData(for: cacheKey) {
            return cached
        }

        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw MeetCalAPIError.badStatus(http.statusCode)
        }

        storeData(data, for: cacheKey)
        return data
    }

    // MARK: TTL cache (memory + UserDefaults)

    private func cachedData(for key: String) -> Data? {
        if let (ts, data) = memoryCache[key], Date().timeIntervalSince(ts) < ttl {
            return data
        }
        // Fall back to the persisted layer (survives process relaunch between
        // Siri invocations).
        let defaults = SharedStore.defaults
        let tsKey = "apiCacheTS::\(key)"
        let dataKey = "apiCacheData::\(key)"
        if let data = defaults.data(forKey: dataKey) {
            let ts = defaults.double(forKey: tsKey)
            if ts > 0, Date().timeIntervalSince1970 - ts < ttl {
                memoryCache[key] = (Date(timeIntervalSince1970: ts), data)
                return data
            }
        }
        return nil
    }

    private func storeData(_ data: Data, for key: String) {
        let now = Date()
        memoryCache[key] = (now, data)
        let defaults = SharedStore.defaults
        defaults.set(data, forKey: "apiCacheData::\(key)")
        defaults.set(now.timeIntervalSince1970, forKey: "apiCacheTS::\(key)")
    }
}
