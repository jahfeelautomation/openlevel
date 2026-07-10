import { useEffect, useState } from 'react'
import { View, Text, FlatList, ActivityIndicator, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useSession } from '../ctx'
import { api } from '../../lib/api'
import { SymbolView } from 'expo-symbols'

export default function ReviewsScreen() {
  const { location } = useSession()
  const [reviews, setReviews] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  
  const [isLoading, setIsLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadData = async () => {
    if (!location?.id) return
    try {
      const data = await api.getReviews(location.id)
      setReviews(data.reviews || [])
      setStats(data.stats || null)
    } catch (e) {
      console.warn('Failed to load reviews', e)
    } finally {
      setIsLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [location?.id])

  const onRefresh = () => {
    setRefreshing(true)
    loadData()
  }

  const renderReview = ({ item }: { item: any }) => {
    return (
      <View className="bg-zinc-900 rounded-xl p-4 mb-3 mx-4 border border-zinc-800">
        <View className="flex-row justify-between mb-2">
          <View className="flex-row items-center">
            <SymbolView name="star.fill" size={16} tintColor="#eab308" />
            <Text className="text-white font-bold text-lg ml-1">{item.rating}</Text>
          </View>
          <Text className="text-zinc-500 text-sm">
            {new Date(item.created_at).toLocaleDateString()}
          </Text>
        </View>

        <Text className="text-white text-base mb-3 leading-6">
          {item.body || 'No review text provided.'}
        </Text>

        <View className="flex-row justify-between items-center mt-2 pt-2 border-t border-zinc-800/50">
          <Text className="text-zinc-400 font-semibold">{item.author}</Text>
          <Text className="text-zinc-600 text-xs uppercase">{item.source}</Text>
        </View>
      </View>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-zinc-950" edges={['top']}>
      <View className="px-4 py-3 border-b border-zinc-800 flex-row justify-between items-center">
        <Text className="text-2xl font-bold text-white">Reviews</Text>
        {stats && (
          <View className="flex-row items-center">
            <SymbolView name="star.fill" size={16} tintColor="#eab308" style={{ marginRight: 4 }} />
            <Text className="text-white font-bold text-lg">{stats.average.toFixed(1)}</Text>
            <Text className="text-zinc-500 ml-1">({stats.total})</Text>
          </View>
        )}
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#3b82f6" />
        </View>
      ) : reviews.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <SymbolView name="star.bubble.fill" size={48} tintColor="#52525b" />
          <Text className="text-zinc-500 mt-4 text-base">No reviews yet</Text>
        </View>
      ) : (
        <FlatList
          data={reviews}
          keyExtractor={(item) => item.id}
          renderItem={renderReview}
          className="pt-4"
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
