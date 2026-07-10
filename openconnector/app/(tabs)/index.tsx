import { useEffect, useState } from 'react'
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useSession } from '../ctx'
import { api } from '../../lib/api'
import { SymbolView } from 'expo-symbols'
import { useRouter } from 'expo-router'

export default function ConversationsScreen() {
  const { location, signOut } = useSession()
  const router = useRouter()
  const [conversations, setConversations] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadConversations = async () => {
    if (!location?.id) return
    try {
      const data = await api.getConversations(location.id)
      setConversations(data.conversations || [])
    } catch (e) {
      console.warn('Failed to load conversations', e)
    } finally {
      setIsLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadConversations()
  }, [location?.id])

  const onRefresh = () => {
    setRefreshing(true)
    loadConversations()
  }

  const renderItem = ({ item }: { item: any }) => {
    // Determine contact name or fallback
    const name = item.contact?.name || item.contact?.phones?.[0] || 'Unknown Contact'
    const statusColor = item.status === 'open' ? 'bg-green-500' : 'bg-zinc-500'

    return (
      <TouchableOpacity 
        className="px-4 py-4 border-b border-zinc-800 flex-row items-center"
        onPress={() => router.push(`/conversation/${item.id}`)}
      >
        <View className="w-12 h-12 rounded-full bg-zinc-800 items-center justify-center mr-4">
          <Text className="text-white text-lg font-bold">{name.charAt(0).toUpperCase()}</Text>
        </View>
        <View className="flex-1">
          <View className="flex-row justify-between items-center mb-1">
            <Text className="text-white font-semibold text-base">{name}</Text>
            <View className={`w-2 h-2 rounded-full ${statusColor}`} />
          </View>
          <Text className="text-zinc-400 text-sm" numberOfLines={1}>
            {item.channel === 'sms' ? 'SMS Message' : 'Message'} from {item.provider}
          </Text>
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-zinc-950" edges={['top']}>
      <View className="px-4 py-3 border-b border-zinc-800 flex-row justify-between items-center">
        <Text className="text-2xl font-bold text-white">Inbox</Text>
        <TouchableOpacity onPress={signOut}>
          <Text className="text-red-400">Sign Out</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#3b82f6" />
        </View>
      ) : conversations.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <SymbolView name="tray" size={48} tintColor="#52525b" />
          <Text className="text-zinc-500 mt-4 text-base">No conversations found</Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
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
