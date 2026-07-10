import { useEffect, useState, useRef } from 'react'
import { View, Text, FlatList, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SymbolView } from 'expo-symbols'
import { useSession } from '../../app/ctx'
import { api } from '../../lib/api'

export default function ConversationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { location } = useSession()
  
  const [conversation, setConversation] = useState<any>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [replyBody, setReplyBody] = useState('')
  const [isSending, setIsSending] = useState(false)
  const flatListRef = useRef<FlatList>(null)

  const loadData = async () => {
    if (!location?.id || !id) return
    try {
      const data = await api.getConversation(location.id, id)
      setConversation(data.conversation)
      setMessages(data.messages || [])
    } catch (e) {
      console.warn('Failed to load conversation', e)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [location?.id, id])

  const handleSend = async () => {
    if (!replyBody.trim() || isSending || !location?.id || !id) return
    
    setIsSending(true)
    try {
      await api.sendMessage(location.id, id, replyBody)
      setReplyBody('')
      loadData()
    } catch (e) {
      console.warn('Failed to send message', e)
    } finally {
      setIsSending(false)
    }
  }

  const renderMessage = ({ item }: { item: any }) => {
    const isOutbound = item.direction === 'outbound'
    return (
      <View className={`w-full mb-4 px-4 ${isOutbound ? 'items-end' : 'items-start'}`}>
        <View className={`max-w-[80%] rounded-2xl px-4 py-3 ${isOutbound ? 'bg-blue-600 rounded-br-none' : 'bg-zinc-800 rounded-bl-none'}`}>
          <Text className="text-white text-base leading-5">{item.body}</Text>
        </View>
        <Text className="text-zinc-500 text-xs mt-1">
          {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    )
  }

  const contactName = conversation?.contact?.name || conversation?.contact?.phones?.[0] || 'Contact'

  return (
    <SafeAreaView className="flex-1 bg-zinc-950" edges={['top', 'bottom']}>
      <View className="px-4 py-3 flex-row items-center border-b border-zinc-800">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <SymbolView name={{ ios: 'chevron.left', android: 'chevron-left', web: 'chevron-left' }} size={24} tintColor="#3b82f6" />
        </TouchableOpacity>
        <Text className="text-xl font-bold text-white flex-1">{contactName}</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#3b82f6" />
        </View>
      ) : (
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            className="flex-1 pt-4"
            contentContainerStyle={{ paddingBottom: 16 }}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          />
          
          <View className="p-4 border-t border-zinc-800 flex-row items-end">
            <TextInput
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-white text-base max-h-32"
              placeholder="Type a message..."
              placeholderTextColor="#52525b"
              multiline
              value={replyBody}
              onChangeText={setReplyBody}
            />
            <TouchableOpacity 
              className={`ml-3 w-12 h-12 rounded-full items-center justify-center ${replyBody.trim() ? 'bg-blue-600' : 'bg-zinc-800'}`}
              onPress={handleSend}
              disabled={!replyBody.trim() || isSending}
            >
              {isSending ? (
                <ActivityIndicator color="white" />
              ) : (
                <SymbolView name="paperplane.fill" size={20} tintColor={replyBody.trim() ? "white" : "#52525b"} />
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  )
}
