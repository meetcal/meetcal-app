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

// MARK: - Request bodies

/// JSON body for the `POST` name-list endpoints (`/lifting-results/by-names`,
/// `/lifting-results/recent`, `/lifting-results/bests`). Matches the backend's
/// `NameListBody`; nil fields are omitted from the JSON.
struct NameListBody: Encodable {
    let names: [String]
    var cutoff_date: String? = nil
    var limit_per_name: Int? = nil
}

// MARK: - History cutoff

/// History-window cutoff dates. Mirrors `getHistoryCutoffDate(years)` and the
/// `YEAR_BESTS_YEARS` constant in utils/dateTime.ts; change them together so
/// Siri and the app ask the API for the same window.
enum HistoryCutoff {
    /// `YEAR_BESTS_YEARS` in utils/dateTime.ts.
    static let yearBestsYears = 1

    /// The `YYYY-MM-DD` cutoff `years` before `now`: today's UTC calendar date
    /// with the year reduced, exactly as the JS
    /// `Date.UTC(y - years, m, d).toISOString().split("T")[0]` computes it.
    static func date(yearsAgo years: Int, now: Date = Date()) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? TimeZone(secondsFromGMT: 0) ?? .current
        let today = calendar.dateComponents([.year, .month, .day], from: now)
        // A Gregorian calendar always fills the components it was asked for.
        return format(
            year: (today.year ?? 1970) - years,
            month: today.month ?? 1,
            day: today.day ?? 1
        )
    }

    /// Formats a calendar date the way JS `Date.UTC` normalizes it. The only
    /// out-of-range input a real "today" can produce is Feb 29 in a non-leap
    /// target year, which `Date.UTC` rolls forward to Mar 1 (not back to
    /// Feb 28, as `Calendar.date(byAdding:)` would).
    static func format(year: Int, month: Int, day: Int) -> String {
        var month = month
        var day = day
        let isLeapYear = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
        if month == 2, day == 29, !isLeapYear {
            month = 3
            day = 1
        }
        return "\(zeroPadded(year, width: 4))-\(zeroPadded(month, width: 2))-\(zeroPadded(day, width: 2))"
    }

    private static func zeroPadded(_ value: Int, width: Int) -> String {
        let digits = String(value)
        return String(repeating: "0", count: max(0, width - digits.count)) + digits
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
    // Same signal the RN app sends; the API gates stricter validation on it.
    private let appVersion =
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    /// Names per name-list request. Matches `NAMES_QUERY_CHUNK_SIZE` in
    /// lib/api/meetcal-api.ts; the API rejects more than `MAX_NAME_LIST_LEN`
    /// (100) names in one request.
    private static let nameChunkSize = 40
    /// The API's `MAX_LIMIT_PER_NAME`; a larger `limit_per_name` is a `400`.
    private static let maxLimitPerName = 200
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

    // Name lists go in a JSON body (`POST`), never a comma-joined query param,
    // so a name containing a comma stays one name. Mirrors
    // `fetchApiResultsByNames` / `fetchApiYearBestsByNames` in
    // lib/api/meetcal-api.ts.

    /// Each name's newest `limitPerName` results (newest first), so a long
    /// career is not downloaded and cached just to show a few rows. Ranges
    /// over the whole history, not a date window, so a lifter who has not
    /// competed lately still gets their last meets.
    func resultsByNames(_ names: [String], limitPerName: Int) async throws -> [APILiftingResult] {
        let cleaned = Self.cleanNameList(names)
        guard !cleaned.isEmpty else { return [] }
        let limit = min(max(limitPerName, 1), Self.maxLimitPerName)
        var rows: [APILiftingResult] = []
        for chunk in Self.chunked(cleaned) {
            let part: [APILiftingResult] = try await postDecoded(
                "/lifting-results/by-names",
                body: NameListBody(names: chunk, limit_per_name: limit)
            )
            rows.append(contentsOf: part)
        }
        return rows
    }

    func bests(names: [String]) async throws -> [String: APIYearBests] {
        let cleaned = Self.cleanNameList(names)
        guard !cleaned.isEmpty else { return [:] }
        // 6.2.0+ clients must send the window. One cutoff for every chunk.
        let cutoff = HistoryCutoff.date(yearsAgo: HistoryCutoff.yearBestsYears)
        var merged: [String: APIYearBests] = [:]
        for chunk in Self.chunked(cleaned) {
            let part: [String: APIYearBests] = try await postDecoded(
                "/lifting-results/bests",
                body: NameListBody(names: chunk, cutoff_date: cutoff)
            )
            merged.merge(part) { _, new in new }
        }
        return merged
    }

    /// Trims each name and drops blanks, as the backend's `clean_name_list`
    /// does, so an all-blank list short-circuits instead of drawing a `400`.
    private static func cleanNameList(_ names: [String]) -> [String] {
        names
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    /// Splits a name list into requests of at most `nameChunkSize` names.
    private static func chunked(_ names: [String]) -> [[String]] {
        stride(from: 0, to: names.count, by: nameChunkSize).map { start in
            Array(names[start..<min(start + nameChunkSize, names.count)])
        }
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
        let data = try await fetchData(path, query: query, jsonBody: nil)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func postDecoded<T: Decodable, Body: Encodable>(
        _ path: String,
        body: Body
    ) async throws -> T {
        let encoder = JSONEncoder()
        // Stable key order so the same request always hits the same cache key.
        encoder.outputFormatting = .sortedKeys
        let bodyData = try encoder.encode(body)
        let data = try await fetchData(path, query: [:], jsonBody: bodyData)
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// `GET` when `jsonBody` is nil, otherwise `POST` with a JSON body.
    private func fetchData(
        _ path: String,
        query: [String: String],
        jsonBody: Data?
    ) async throws -> Data {
        var components = URLComponents(
            url: baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )
        if !query.isEmpty {
            components?.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components?.url else { throw MeetCalAPIError.invalidURL }
        // GET keys stay the bare URL; POST keys add the body, since the URL
        // alone does not identify the request.
        var cacheKey = url.absoluteString
        if let jsonBody {
            cacheKey = "POST \(cacheKey) \(String(decoding: jsonBody, as: UTF8.self))"
        }

        if let cached = cachedData(for: cacheKey) {
            return cached
        }

        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let jsonBody {
            request.httpMethod = "POST"
            request.httpBody = jsonBody
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if !appVersion.isEmpty {
            request.setValue(appVersion, forHTTPHeaderField: "X-MeetCal-App")
        }

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
