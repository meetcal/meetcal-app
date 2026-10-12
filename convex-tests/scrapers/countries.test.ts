import { COUNTRY_ZONES, countryTimeZone, isUnitedStates, oneClockCountryZone, usTerritoryTimeZone } from '../../convex/scrapers/lib/countries';
import { isMeetTimeZone } from '../../convex/lib/validation';
import { timeZoneFor } from '../../convex/scrapers/parse/usamwEvents';
import { addressTimeZone } from '../../convex/scrapers/parse/meets';

describe('countries and US territories', () => {
  it('gives only IANA zones the runtime knows', () => {
    expect(COUNTRY_ZONES.length).toBeGreaterThan(100);
    for (const zone of COUNTRY_ZONES) expect([zone, isMeetTimeZone(zone)]).toEqual([zone, true]);
  });

  it('gives a one-clock country its zone, whatever the spelling', () => {
    expect(countryTimeZone(['Japan'])).toEqual({ country: 'Japan', zone: 'Asia/Tokyo' });
    expect(countryTimeZone([' INDIA '])).toEqual({ country: 'INDIA', zone: 'Asia/Kolkata' });
    expect(countryTimeZone(['Türkiye'])?.zone).toBe('Europe/Istanbul');
    expect(countryTimeZone(['Côte d’Ivoire'])?.zone).toBe('Africa/Abidjan');
    expect(countryTimeZone(['Republic of Korea'])?.zone).toBe('Asia/Seoul');
    expect(countryTimeZone(['United Kingdom'])?.zone).toBe('Europe/London');
    expect(countryTimeZone(['Samoa'])?.zone).toBe('Pacific/Apia');
    expect(countryTimeZone(['American Samoa'])?.zone).toBe('Pacific/Pago_Pago');
  });

  it('gives no zone for a country with several, and nothing for a name it does not know', () => {
    for (const country of ['Canada', 'Mexico', 'Australia', 'Brazil', 'Russia', 'Indonesia', 'Chile']) {
      expect(countryTimeZone([country])).toEqual({ country, zone: null });
    }
    expect(countryTimeZone(['Atlantis'])).toBeNull();
    // Not the US state either: Georgia is read as the state first.
    expect(countryTimeZone(['Georgia'])).toBeNull();
    expect(countryTimeZone(['constructor', 'toString'])).toBeNull();
  });

  it('takes the first name that is a country', () => {
    expect(countryTimeZone(['08019', 'Spain', 'Catalonia'])).toEqual({ country: 'Spain', zone: 'Europe/Madrid' });
  });

  it('gives outlying islands their own clock', () => {
    expect(countryTimeZone(['Spain'], 'Pabellón, Santa Cruz de Tenerife, Spain')?.zone).toBe('Atlantic/Canary');
    expect(countryTimeZone(['Spain'], 'Las Palmas de Gran Canaria')?.zone).toBe('Atlantic/Canary');
    expect(countryTimeZone(['Portugal'], 'Ponta Delgada, Açores')?.zone).toBe('Atlantic/Azores');
    expect(countryTimeZone(['Portugal'], 'Funchal, Madeira')?.zone).toBe('Europe/Lisbon');
    expect(countryTimeZone(['New Zealand'], 'Chatham Islands')?.zone).toBe('Pacific/Chatham');
    expect(countryTimeZone(['Ecuador'], 'Puerto Ayora, Galápagos')?.zone).toBe('Pacific/Galapagos');
    expect(countryTimeZone(['Ecuador'], 'Quito')?.zone).toBe('America/Guayaquil');
    // Whole words only: "Hortaleza" (Madrid) is not Horta (Azores), and Spain has no Horta.
    expect(countryTimeZone(['Portugal'], 'Hortaleza')?.zone).toBe('Europe/Lisbon');
  });

  it('knows the United States and its territories', () => {
    expect(isUnitedStates('United States of America')).toBe(true);
    expect(isUnitedStates(' USA ')).toBe(true);
    expect(isUnitedStates('United Kingdom')).toBe(false);
    expect(usTerritoryTimeZone('Puerto Rico')).toBe('America/Puerto_Rico');
    expect(usTerritoryTimeZone('Guam')).toBe('Pacific/Guam');
    expect(usTerritoryTimeZone('Japan')).toBeNull();
    expect(usTerritoryTimeZone('constructor')).toBeNull();
  });

  it('confirms a zone from the country alone only where the country has one clock', () => {
    expect(oneClockCountryZone('Japan')).toBe('Asia/Tokyo');
    expect(oneClockCountryZone('Spain')).toBeNull();
    expect(oneClockCountryZone('Canada')).toBeNull();
    expect(oneClockCountryZone('TN')).toBeNull();
  });
});

describe('a widget address', () => {
  it('reads the country abroad and the state at home', () => {
    expect(addressTimeZone('Hall, 1 St, Seoul, South Korea, 04524', 'South Korea', 'Seoul')).toEqual({ zone: 'Asia/Seoul' });
    // No postcode: the country is the last part.
    expect(addressTimeZone('Hall, 1 St, Athens, Greece', 'Athens', '1 St')).toEqual({ zone: 'Europe/Athens' });
    expect(addressTimeZone('Hall, 1 St, Toronto, Ontario, Canada, M5V 1J1', 'Canada', 'Toronto')).toEqual({ problem: 'Canada spans several time zones' });
    // A US address never reads a town named like a country as one.
    expect(addressTimeZone('Gym, 1 St, Peru, Indiana, United States of America, 46970', 'Indiana', 'Peru')).toEqual({ zone: 'America/New_York' });
    expect(addressTimeZone('Gym, 1 St, Hagatna, Guam, United States of America, 96910', 'Guam', 'Hagatna')).toEqual({ zone: 'Pacific/Guam' });
    // No postcode and no country: the last part is a state, not Lebanon's town read as the country.
    expect(addressTimeZone('Gym, 1 Main St, Lebanon, Ohio', 'Lebanon', '1 Main St')).toEqual({ problem: 'state "Lebanon"' });
  });

  it('reads islands in the city and region only, never the street', () => {
    expect(addressTimeZone('Gym, Calle de las Palmas 10, Madrid, Madrid, Spain, 28004', 'Spain', 'Madrid')).toEqual({ zone: 'Europe/Madrid' });
    expect(addressTimeZone('Gym, Calle Mayor 1, La Laguna, Santa Cruz de Tenerife, Spain, 38201', 'Spain', 'La Laguna')).toEqual({ zone: 'Atlantic/Canary' });
    expect(addressTimeZone('Pavilhao, Rua 1, Ponta Delgada, Acores, Portugal, 9500-150', 'Portugal', 'Ponta Delgada')).toEqual({ zone: 'Atlantic/Azores' });
  });
});

describe('USA Masters event zones', () => {
  it('reads one-clock countries and leaves several-zone ones to a person', () => {
    expect(timeZoneFor('Japan', 'Kansai', 'Kansai, Japan')).toBe('Asia/Tokyo');
    expect(timeZoneFor('Puerto Rico', 'San Juan', 'San Juan, Puerto Rico')).toBe('America/Puerto_Rico');
    // The old table guessed Toronto and Mexico City for the whole country.
    expect(timeZoneFor('Canada', 'Vancouver', 'Vancouver, Canada')).toBeUndefined();
    expect(timeZoneFor('Mexico', 'Tijuana', 'Tijuana, Mexico')).toBeUndefined();
    // Parts are matched whole: a place containing a country's name is not it.
    expect(timeZoneFor('Panama City Beach', 'Panama City Beach', 'Panama City Beach\nBeach Resort')).toBeUndefined();
    expect(timeZoneFor('Oman Hall', 'Romania Street', 'Romania Street')).toBeUndefined();
  });
});
