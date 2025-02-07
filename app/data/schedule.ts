// Add a helper function to get session weight class
export function getSessionWeightClass(sessionNumber: number, platform: string): string | undefined {
  const sessionDay = schedule.find(day => 
    day.sessions.some(s => s.number === sessionNumber)
  );
  
  const session = sessionDay?.sessions.find(s => 
    s.number === sessionNumber
  );

  const platformData = session?.platforms.find(p => 
    p.platform === platform
  );

  return platformData?.weightClass;
} 