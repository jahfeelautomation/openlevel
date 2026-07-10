import { useEffect, useState } from 'react'
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SymbolView } from 'expo-symbols'
import { useSession } from '../../app/ctx'
import { api } from '../../lib/api'

export default function ContactDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { location } = useSession()
  
  const [contact, setContact] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      if (!location?.id || !id) return
      try {
        const data = await api.getContact(location.id, id)
        setContact(data.contact)
      } catch (e) {
        console.warn('Failed to load contact', e)
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [location?.id, id])

  const name = contact?.name || `${contact?.first_name || ''} ${contact?.last_name || ''}`.trim() || 'Unknown Contact'

  return (
    <SafeAreaView className="flex-1 bg-zinc-950" edges={['top', 'bottom']}>
      <View className="px-4 py-3 flex-row items-center border-b border-zinc-800">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <SymbolView name={{ ios: 'chevron.left', android: 'chevron-left', web: 'chevron-left' }} size={24} tintColor="#3b82f6" />
        </TouchableOpacity>
        <Text className="text-xl font-bold text-white">Contact Info</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#3b82f6" />
        </View>
      ) : !contact ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-zinc-500">Contact not found</Text>
        </View>
      ) : (
        <ScrollView className="flex-1 p-6">
          <View className="items-center mb-8">
            <View className="w-24 h-24 rounded-full bg-blue-600 items-center justify-center mb-4">
              <Text className="text-white text-4xl font-bold">{name.charAt(0).toUpperCase()}</Text>
            </View>
            <Text className="text-2xl font-bold text-white mb-1">{name}</Text>
            {contact.source && (
              <Text className="text-zinc-400">Source: {contact.source}</Text>
            )}
          </View>

          <View className="bg-zinc-900 rounded-2xl p-4 mb-4">
            <Text className="text-zinc-500 text-sm font-semibold mb-3 uppercase">Contact Details</Text>
            
            {contact.phones?.map((phone: string, i: number) => (
              <View key={i} className="flex-row items-center mb-3">
                <SymbolView name="phone.fill" size={20} tintColor="#9ca3af" style={{ marginRight: 12 }} />
                <Text className="text-white text-base">{phone}</Text>
              </View>
            ))}

            {contact.emails?.map((email: string, i: number) => (
              <View key={i} className="flex-row items-center mb-3">
                <SymbolView name="envelope.fill" size={20} tintColor="#9ca3af" style={{ marginRight: 12 }} />
                <Text className="text-white text-base">{email}</Text>
              </View>
            ))}

            {(!contact.phones?.length && !contact.emails?.length) && (
              <Text className="text-zinc-500 italic">No contact details provided.</Text>
            )}
          </View>

          {contact.tags?.length > 0 && (
            <View className="bg-zinc-900 rounded-2xl p-4">
              <Text className="text-zinc-500 text-sm font-semibold mb-3 uppercase">Tags</Text>
              <View className="flex-row flex-wrap">
                {contact.tags.map((tag: string, i: number) => (
                  <View key={i} className="bg-zinc-800 rounded-full px-3 py-1 mr-2 mb-2">
                    <Text className="text-zinc-300 text-sm">{tag}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}
