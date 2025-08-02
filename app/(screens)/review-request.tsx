import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Linking,
  Platform,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function ReviewRequestScreen() {
  const router = useRouter();

  const handleClosePress = async () => {
    await AsyncStorage.setItem('hasShownReview', 'true');
    router.push('/saved');
  };

  const handleReviewPress = async () => {
    await AsyncStorage.setItem('hasShownReview', 'true');
    const url = Platform.OS === 'ios' 
      ? 'https://apps.apple.com/us/app/meetcal/id6741133286' 
      : 'https://play.google.com/store/apps/details?id=com.memohnsen.meetcal';
    
    await Linking.openURL(url);
    router.push('/saved');
  };

  const handlePdfPress = async () => {
    await AsyncStorage.setItem('hasShownReview', 'true');
    router.push('/saved');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#1a1a1a' }}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
      
      {/* Header with close button */}
      <View style={{
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 10,
        paddingBottom: 20,
      }}>
        <TouchableOpacity
          onPress={handleClosePress}
          style={{
            padding: 8,
            borderRadius: 20,
            backgroundColor: '#333',
          }}
        >
          <Ionicons name="close" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Main content */}
      <View style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 40,
      }}>
        {/* Icon */}
        <View style={{
          width: 80,
          height: 80,
          borderRadius: 40,
          backgroundColor: '#007AFF',
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 30,
        }}>
          <Ionicons name="star" size={40} color="#fff" />
        </View>

        {/* Title */}
        <Text style={{
          fontSize: 28,
          fontWeight: 'bold',
          color: '#fff',
          textAlign: 'center',
          marginBottom: 16,
        }}>
          Enjoying MeetCal?
        </Text>

        {/* Subtitle */}
        <Text style={{
          fontSize: 18,
          color: '#ccc',
          textAlign: 'center',
          lineHeight: 24,
          marginBottom: 40,
        }}>
          Please consider leaving a review!
        </Text>

        {/* Buttons */}
        <View style={{ width: '100%', gap: 16 }}>
          {/* Leave Review Button */}
          <TouchableOpacity
            onPress={handleReviewPress}
            style={{
              backgroundColor: '#007AFF',
              paddingVertical: 16,
              paddingHorizontal: 32,
              borderRadius: 12,
              alignItems: 'center',
            }}
          >
            <Text style={{
              color: '#fff',
              fontSize: 18,
              fontWeight: '600',
            }}>
              Leave Review
            </Text>
          </TouchableOpacity>

          {/* I Prefer PDFs Button */}
          <TouchableOpacity
            onPress={handlePdfPress}
            style={{
              backgroundColor: 'transparent',
              paddingVertical: 16,
              paddingHorizontal: 32,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: '#666',
              alignItems: 'center',
            }}
          >
            <Text style={{
              color: '#ccc',
              fontSize: 16,
              fontWeight: '500',
            }}>
              I Prefer PDFs
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Bottom spacing */}
      <View style={{ height: 60 }} />
    </SafeAreaView>
  );
}