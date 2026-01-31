import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, Pressable, Platform } from 'react-native';
import { useOTAUpdates } from '@/hooks/useOTAUpdates';
import { useTheme } from '@/contexts/ThemeContext';

export function UpdateNotification() {
  const {
    isUpdateAvailable,
    isDownloading,
    error,
    downloadAndRestart,
    dismissUpdate,
  } = useOTAUpdates();
  const { currentTheme } = useTheme();

  const isDark = currentTheme === 'dark';
  const visible = isUpdateAvailable || !!error;

  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={dismissUpdate}
      statusBarTranslucent
      {...(Platform.OS === 'ios' && { presentationStyle: 'overFullScreen' })}
    >
      <Pressable style={styles.backdrop} onPress={dismissUpdate}>
        <Pressable style={[styles.modalCard, { backgroundColor: isDark ? '#1c1c1e' : '#f2f2f7' }]} onPress={(e) => e.stopPropagation()}>
      {error ? (
        <View style={styles.content}>
          <Text style={[
            styles.title,
            { color: isDark ? '#ff453a' : '#ff3b30' }
          ]}>
            Update Error
          </Text>
          <Text style={[
            styles.message,
            { color: isDark ? '#ffffff' : '#000000' }
          ]}>
            {error}
          </Text>
          <TouchableOpacity
            style={[styles.button, styles.dismissButton]}
            onPress={dismissUpdate}
          >
            <Text style={styles.dismissButtonText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.content}>
          <Text style={[
            styles.title,
            { color: isDark ? '#30d158' : '#34c759' }
          ]}>
            Update Available
          </Text>
          <Text style={[
            styles.message,
            { color: isDark ? '#ffffff' : '#000000' }
          ]}>
            A new version of the app is available. Update now for the latest features and improvements.
          </Text>
          
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.button, styles.laterButton]}
              onPress={dismissUpdate}
              disabled={isDownloading}
            >
              <Text style={[
                styles.laterButtonText,
                { color: isDark ? '#0a84ff' : '#007aff' }
              ]}>
                Later
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[
                styles.button,
                styles.updateButton,
                { backgroundColor: isDark ? '#0a84ff' : '#007aff' },
                isDownloading && styles.disabledButton
              ]}
              onPress={downloadAndRestart}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator color="white" size="small" />
                  <Text style={styles.updateButtonText}>Updating...</Text>
                </View>
              ) : (
                <Text style={styles.updateButtonText}>Update Now</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  content: {
    padding: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 16,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  laterButton: {
    backgroundColor: 'transparent',
  },
  laterButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  updateButton: {
    backgroundColor: '#007aff',
  },
  updateButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  dismissButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#ff3b30',
  },
  dismissButtonText: {
    color: '#ff3b30',
    fontSize: 16,
    fontWeight: '500',
  },
  disabledButton: {
    opacity: 0.6,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});