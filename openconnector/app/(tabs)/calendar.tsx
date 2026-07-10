import { useEffect, useState } from 'react'
import { View, Text, FlatList, ActivityIndicator, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useSession } from '../ctx'
import { api } from '../../lib/api'
import { SymbolView } from 'expo-symbols'

export default function CalendarScreen() {
  const { location } = useSession()
  const [appointments, setAppointments] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadAppointments = async () => {
    if (!location?.id) return
    try {
      const data = await api.getAppointments(location.id)
      setAppointments(data.appointments || [])
    } catch (e) {
      console.warn('Failed to load appointments', e)
    } finally {
      setIsLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadAppointments()
  }, [location?.id])

  const onRefresh = () => {
    setRefreshing(true)
    loadAppointments()
  }

  const renderItem = ({ item }: { item: any }) => {
    const startsAt = new Date(item.starts_at)
    const endsAt = new Date(item.ends_at)
    const isPast = endsAt < new Date()
    
    return (
      <View className={`px-4 py-4 border-b border-zinc-800 ${isPast ? 'opacity-50' : ''}`}>
        <View className="flex-row justify-between mb-2">
          <Text className="text-white font-semibold text-lg">{item.title}</Text>
          <View className={`px-2 py-1 rounded ${item.status === 'scheduled' ? 'bg-blue-600/20' : 'bg-zinc-800'}`}>
            <Text className={`text-xs uppercase font-bold ${item.status === 'scheduled' ? 'text-blue-400' : 'text-zinc-400'}`}>
              {item.status.replace('_', ' ')}
            </Text>
          </View>
        </View>
        
        <View className="flex-row items-center mb-1">
          <SymbolView name="clock.fill" size={16} tintColor="#9ca3af" style={{ marginRight: 8 }} />
          <Text className="text-zinc-300">
            {startsAt.toLocaleDateString()} • {startsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>

        {item.contact && (
          <View className="flex-row items-center mt-1">
            <SymbolView name="person.fill" size={16} tintColor="#9ca3af" style={{ marginRight: 8 }} />
            <Text className="text-zinc-400">
              {item.contact.name || item.contact.phones?.[0] || 'Unknown Contact'}
            </Text>
          </View>
        )}
      </View>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-zinc-950" edges={['top']}>
      <View className="px-4 py-3 border-b border-zinc-800">
        <Text className="text-2xl font-bold text-white">Calendar</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#3b82f6" />
        </View>
      ) : appointments.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <SymbolView name="calendar" size={48} tintColor="#52525b" />
          <Text className="text-zinc-500 mt-4 text-base">No appointments</Text>
        </View>
      ) : (
        <FlatList
          data={appointments}
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
