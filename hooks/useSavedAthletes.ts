import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LiftResult } from '@/data/types/athletes';

const SAVED_ATHLETES_KEY = '@saved_athletes';

export function useSavedAthletes() {
  const [savedAthletes, setSavedAthletes] = useState<LiftResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSavedAthletes();
  }, []);

  const loadSavedAthletes = async () => {
    try {
      const saved = await AsyncStorage.getItem(SAVED_ATHLETES_KEY);
      if (saved) {
        setSavedAthletes(JSON.parse(saved));
      }
    } catch (error) {
      console.error('Error loading saved athletes:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveAthletes = async (athletes: LiftResult[]) => {
    try {
      // Combine existing and new athletes, removing duplicates
      const uniqueAthletes = [...savedAthletes];
      
      athletes.forEach(athlete => {
        if (!uniqueAthletes.some(saved => saved.name === athlete.name)) {
          uniqueAthletes.push(athlete);
        }
      });

      await AsyncStorage.setItem(SAVED_ATHLETES_KEY, JSON.stringify(uniqueAthletes));
      setSavedAthletes(uniqueAthletes);
      return true;
    } catch (error) {
      console.error('Error saving athletes:', error);
      return false;
    }
  };

  const removeAthlete = async (athleteName: string) => {
    try {
      const updatedAthletes = savedAthletes.filter(athlete => athlete.name !== athleteName);
      await AsyncStorage.setItem(SAVED_ATHLETES_KEY, JSON.stringify(updatedAthletes));
      setSavedAthletes(updatedAthletes);
      return true;
    } catch (error) {
      console.error('Error removing athlete:', error);
      return false;
    }
  };

  return {
    savedAthletes,
    isLoading,
    saveAthletes,
    removeAthlete,
  };
} 