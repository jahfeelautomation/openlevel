import { useEffect, useState } from 'react'
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useSession } from '../ctx'
import { api } from '../../lib/api'
import { SymbolView } from 'expo-symbols'
import { useRouter } from 'expo-router'

export default function ContactsScreen() {
  const { location } = useSession()
  const router = useRouter()
  const [contacts, setContacts] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadContacts = async () => {
    if (!location?.id) return
    try {
      const data = await api.getContacts(location.id)
      setContacts(data.contacts || [])
    } catch (e) {
      console.warn('Failed to load contacts', e)
    } finally {
      setIsLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadContacts()
  }, [location?.id])

  const onRefresh = () => {
    setRefreshing(true)
    loadContacts()
  }

  const renderItem = ({ item }: { item: any }) => {
    const name = item.name || `${item.first_name || ''} ${item.last_name || ''}`.trim() || item.phones?.[0] || item.emails?.[0] || 'Unknown Contact'

    return (
      <TouchableOpacity 
        className="px-4 py-4 border-b border-zinc-800 flex-row items-center"
        onPress={() => router.push(`/contact/${item.id}`)}
      >
        <View className="w-12 h-12 rounded-full bg-zinc-800 items-center justify-center mr-4">
          <Text className="text-white text-lg font-bold">{name.charAt(0).toUpperCase()}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-white font-semibold text-base mb-1">{name}</Text>
          {item.phones?.[0] ? (
            <Text className="text-zinc-400 text-sm">{item.phones[0]}</Text>
          ) : item.emails?.[0] ? (
            <Text className="text-zinc-400 text-sm">{item.emails[0]}</Text>
          ) : null}
        </View>
        <SymbolView name="chevron.right" size={20} tintColor="#52525b" />
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-zinc-950" edges={['top']}>
      <View className="px-4 py-3 border-b border-zinc-800">
        <Text className="text-2xl font-bold text-white">Contacts</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#3b82f6" />
        </View>
      ) : contacts.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <SymbolView name="person.2.fill" size={48} tintColor="#52525b" />
          <Text className="text-zinc-500 mt-4 text-base">No contacts found</Text>
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#3b82f6"
            />
          }
        />
      )}
    </SafeAreaView>
  )
}
