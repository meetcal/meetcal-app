import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, TouchableOpacity, Alert, Platform, Modal, TextInput, Pressable, ScrollView, Linking, KeyboardAvoidingView, Keyboard } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useTheme } from '@/contexts/ThemeContext';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { useClerk, useUser } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import RevenueCatUI from 'react-native-purchases-ui';
import { NotificationSettings } from '@/components/NotificationSettings';
import { useSubscription } from '@/contexts/SubscriptionContext';

type EditableField = 'firstName' | 'lastName' | 'email';
export type SubscriptionStatus = 'free' | 'quarterly' | 'lifetime';

export default function ProfileScreen() {
  const { currentTheme } = useTheme();
  const { signOut } = useClerk();
  const { user } = useUser();
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const insets = useSafeAreaInsets();
  const { isSubscribed, subscriptionType } = useSubscription();

  // Define theme colors to match other screens
  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
    link: '#007AFF',
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      router.replace('/(tabs)/info');
    } catch (err) {
      console.error('Error signing out:', err);
      Alert.alert('Error', 'Failed to sign out. Please try again.');
    }
  };

  const handleEdit = (field: EditableField) => {
    let currentValue = '';
    switch (field) {
      case 'firstName':
        currentValue = user?.firstName || '';
        break;
      case 'lastName':
        currentValue = user?.lastName || '';
        break;
      case 'email':
        currentValue = user?.primaryEmailAddress?.emailAddress || '';
        break;
    }
    setEditValue(currentValue);
    setEditingField(field);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!editingField || !user) return;
    
    setIsLoading(true);
    try {
      switch (editingField) {
        case 'firstName':
          await user.update({
            firstName: editValue,
          });
          break;
        case 'lastName':
          await user.update({
            lastName: editValue,
          });
          break;
        case 'email':
          // Ensure email is different before creating
          if (editValue === user.primaryEmailAddress?.emailAddress) {
            setIsEditing(false);
            setEditingField(null);
            return; // No change needed
          }
          const emailAddress = await user.createEmailAddress({
            email: editValue,
          });
          await emailAddress.prepareVerification({
            strategy: 'email_code',
          });

          Alert.alert(
            'Verification Required',
            'Please check your email to verify your new email address.'
          );
          break;
      }
      setIsEditing(false);
      setEditingField(null);
    } catch (err) {
      console.error('Error updating profile:', err);
      Alert.alert('Error', 'Failed to update profile. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubscription = () => {
    router.push({
      pathname: '/(screens)/subscription',
      params: { from: 'profile' }
    });
  };

  const formatTitle = (field: string) => {
    return field
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const renderField = (label: string, value: string, field: EditableField) => (
    <Pressable
      style={({ pressed }) => [
        styles.section,
        { 
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
          backgroundColor: colors.card
        },
        pressed && { backgroundColor: colors.pressed }
      ]}
      onPress={() => handleEdit(field)}
    >
      <View style={styles.fieldRow}>
        <View>
          <ThemedText style={[styles.label, { color: colors.text }]}>
            {label}
          </ThemedText>
          <ThemedText style={[styles.value, { color: colors.secondaryText }]}>
            {value || 'Not set'}
          </ThemedText>
        </View>
        <IconSymbol
          name={Platform.OS === 'ios' ? 'chevron.right' : 'chevron-forward'}
          size={20}
          color={colors.link}
        />
      </View>
    </Pressable>
  );

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen 
        options={{ 
          headerShown: true,
          headerTitle: '',
          headerTintColor: colors.link,
          headerBackTitle: 'Back',
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
        }} 
      />
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { 
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: Math.max(80, insets.bottom + 60)
          }
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ThemedText style={[styles.title, { color: colors.text }]}>
          My Profile
        </ThemedText>

        <View style={[styles.card, { backgroundColor: colors.card }]}>
          {renderField('First Name', user?.firstName || '', 'firstName')}
          {renderField('Last Name', user?.lastName || '', 'lastName')}
          {renderField('Email', user?.primaryEmailAddress?.emailAddress || '', 'email')}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <NotificationSettings colors={colors} subscriptionStatus={subscriptionType || 'free'} />
        </View>

        <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={async () => {
              try {
                await RevenueCatUI.presentCustomerCenter();
              } catch (error) {
                console.error('Error opening Customer Center:', error);
                Alert.alert('Error', 'Unable to open Customer Center. Please try again later.');
              }
            }}
          >
            <View style={styles.fieldRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Customer Support
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>
        </View>

        <View style={styles.legalLinks}>
          <Pressable onPress={() => Linking.openURL('https://meetcal.app/privacy')}>
            <ThemedText style={[styles.legalText, { color: colors.link }]}>
              Privacy Policy
            </ThemedText>
          </Pressable>
          <ThemedText style={[styles.legalText, { color: colors.secondaryText }]}> • </ThemedText>
          <Pressable onPress={() => Linking.openURL('https://meetcal.app/terms')}>
            <ThemedText style={[styles.legalText, { color: colors.link }]}>
              Terms of Use
            </ThemedText>
          </Pressable>
          <ThemedText style={[styles.legalText, { color: colors.secondaryText }]}> • </ThemedText>
          <Pressable onPress={() => Linking.openURL(
            Platform.OS === 'ios' 
              ? 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'
              : 'https://meetcal.app/eula'
          )}>
            <ThemedText style={[styles.legalText, { color: colors.link }]}>
              User Agreement
            </ThemedText>
          </Pressable>
        </View>

        <TouchableOpacity
          style={[styles.signOutButton]}
          onPress={handleSignOut}
        >
          <ThemedText style={styles.signOutButtonText}>
            Sign Out
          </ThemedText>
        </TouchableOpacity>
      </ScrollView>

      {/* Edit Modal */}
      <Modal
        visible={isEditing}
        transparent
        animationType="fade"
        onRequestClose={() => setIsEditing(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <Pressable 
            style={[
              styles.modalOverlay,
              { backgroundColor: currentTheme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)' }
            ]}
            onPress={() => {
              Keyboard.dismiss();
              setIsEditing(false);
            }}
          >
            <View 
              style={[
                styles.modalContent, 
                { 
                  backgroundColor: colors.card,
                  paddingBottom: insets.bottom + 20,
                  maxHeight: '80%'
                }
              ]}
            >
              <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                <ThemedText style={[styles.modalTitle, { color: colors.text }]}>
                  Edit {editingField ? formatTitle(editingField) : ''}
                </ThemedText>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={() => {
                    Keyboard.dismiss();
                    setIsEditing(false);
                  }}
                >
                  <IconSymbol 
                    name={Platform.OS === 'ios' ? 'xmark' : 'close'}
                    size={20} 
                    color={colors.secondaryText} 
                  />
                </TouchableOpacity>
              </View>

              <ScrollView 
                style={styles.modalBody}
                keyboardShouldPersistTaps="handled"
              >
                <>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        color: colors.text,
                        backgroundColor: currentTheme === 'dark' ? '#2C2C2E' : '#F6F6F7',
                        borderColor: colors.border,
                      },
                    ]}
                    value={editValue}
                    onChangeText={setEditValue}
                    placeholder={`Enter ${formatTitle(editingField || '')}`}
                    placeholderTextColor={colors.secondaryText}
                    autoCapitalize={editingField === 'email' ? 'none' : 'words'}
                    keyboardType={editingField === 'email' ? 'email-address' : 'default'}
                    autoFocus
                  />

                  <TouchableOpacity
                    style={[styles.saveButton, isLoading && styles.saveButtonDisabled]}
                    onPress={() => {
                      Keyboard.dismiss();
                      handleSave();
                    }}
                    disabled={isLoading}
                  >
                    <ThemedText style={styles.saveButtonText}>
                      Save Changes
                    </ThemedText>
                  </TouchableOpacity>
                </>
              </ScrollView>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 24,
    textAlign: 'left',
    lineHeight: 40,
  },
  card: {
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    overflow: 'hidden',
  },
  section: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  value: {
    fontSize: 15,
  },
  signOutButton: {
    backgroundColor: '#FF3B30',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 32,
  },
  signOutButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  modalHeader: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    padding: 4,
  },
  modalBody: {
    padding: 16,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 17,
    marginBottom: 16,
  },
  saveButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  roleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  roleOptionText: {
    fontSize: 17,
    lineHeight: 22,
  },
  link: {
    fontSize: 17,
    lineHeight: 22,
  },
  legalLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  legalText: {
    fontSize: 14,
  },
}); 