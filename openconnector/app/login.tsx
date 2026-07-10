import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from 'react-native'
import { Redirect, useRouter } from 'expo-router'
import { useSession } from './ctx'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function LoginScreen() {
  const { signIn, session, isLoading } = useSession()
  const router = useRouter()
  
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-950">
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    )
  }

  if (session) {
    return <Redirect href="/(tabs)" />
  }

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter both email and password.')
      return
    }
    
    setIsSubmitting(true)
    try {
      await signIn(email, password)
      router.replace('/(tabs)')
    } catch (e: any) {
      Alert.alert('Login Failed', e.message || 'Invalid credentials')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-zinc-950">
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1 justify-center px-6"
      >
        <View className="items-center mb-10">
          <Text className="text-4xl font-bold text-white mb-2">OpenLevel</Text>
          <Text className="text-zinc-400 text-lg">Sign in to your account</Text>
        </View>

        <View className="space-y-4">
          <View>
            <Text className="text-zinc-400 mb-1 ml-1">Email</Text>
            <TextInput
              className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 text-white text-base"
              placeholder="operator@openlevel.com"
              placeholderTextColor="#52525b"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
          </View>
          
          <View className="mt-4">
            <Text className="text-zinc-400 mb-1 ml-1">Password</Text>
            <TextInput
              className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 text-white text-base"
              placeholder="••••••••"
              placeholderTextColor="#52525b"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <TouchableOpacity 
            className="bg-blue-600 rounded-xl py-4 mt-6 items-center flex-row justify-center"
            onPress={handleLogin}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="white" className="mr-2" />
            ) : null}
            <Text className="text-white font-semibold text-lg">
              {isSubmitting ? 'Signing in...' : 'Sign In'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
